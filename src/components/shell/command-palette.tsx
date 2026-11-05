"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Briefcase,
  Building2,
  CalendarDays,
  ChevronsLeft,
  CircleCheck,
  CircleUser,
  CircleX,
  ClipboardList,
  Copy,
  FileText,
  Gavel,
  Handshake,
  History,
  House,
  Kanban,
  Keyboard,
  Landmark,
  Layers,
  ListChecks,
  ListTodo,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Settings,
  Target,
  Ticket,
  User,
  UserCheck,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import { useAccess } from "@/lib/access-control";
import { issueTypeMeta, lifecycleMeta, ticketPriorityMeta } from "@/lib/meta";
import type { LifecycleStage, TicketPriority } from "@/lib/types";
import { cn, formatDate, formatIDR, fromDateInput, isDateInput, softText, todayInput } from "@/lib/utils";
import { Kbd } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { initiativeStatusMeta } from "@/components/initiatives/shared";
import { PROJECT_TYPE_META, ROLE_META } from "@/lib/initiatives/policy";
import { LIVE_PROJECT_STATUSES } from "@/components/projects/model";
import { applyDealChange, requestDealStage } from "@/components/crm/deal-close";
import { normalizePhone, phoneKeywords, tokenFilter, topMatches } from "@/lib/search";
import { readRecent, recordFromPath, toggleNavigation, type RecentVisit } from "./hotkeys";

const RegisterProjectDialog = dynamic(() => import("@/components/projects/register-project-dialog").then((m) => m.RegisterProjectDialog), { ssr: false, loading: () => null });

const itemCls =
  "flex cursor-pointer select-none items-center gap-2.5 rounded px-2.5 py-2 text-sm text-sg-text aria-selected:bg-sg-card-3 aria-selected:text-sg-white data-[disabled=true]:opacity-40";
const groupCls =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-sg-dim";

export { tokenFilter };

/** Records shown per result group before "See all in …". */
const GROUP_LIMIT = 8;

interface NavEntry {
  href: string;
  label: string;
  icon: LucideIcon;
  keys?: string;
  keywords?: string[];
  /** only for viewers who may see everyone's pay (§13.4) */
  pay?: boolean;
}

const NAV_ITEMS: NavEntry[] = [
  { href: "/home", label: "Home", icon: House, keys: "G H", keywords: ["dashboard", "today", "overview"] },
  { href: "/deals", label: "Deals pipeline", icon: Handshake, keys: "G D" },
  { href: "/contacts", label: "Contacts", icon: Users, keys: "G C" },
  { href: "/companies", label: "Companies", icon: Building2, keys: "G O" },
  { href: "/tickets", label: "Tickets", icon: Ticket, keys: "G T", keywords: ["support", "service", "helpdesk"] },
  { href: "/quotes", label: "Quotes", icon: FileText, keys: "G Q", keywords: ["penawaran", "proposal", "approval", "ppn", "faktur"] },
  { href: "/board", label: "Agile board", icon: Kanban, keys: "G B" },
  { href: "/backlog", label: "Backlog & Sprints", icon: ListChecks, keys: "G L", keywords: ["sprint", "planning", "scrum"] },
  { href: "/issues", label: "Issues", icon: ListTodo, keys: "G U", keywords: ["jira", "bugs", "stories", "tasks"] },
  { href: "/projects", label: "Ongoing projects", icon: Layers, keys: "G J", keywords: ["register", "delivery", "programme"] },
  { href: "/initiatives", label: "Initiatives", icon: Briefcase, keys: "G I", keywords: ["prc", "proposals", "projects"] },
  { href: "/compensation", label: "Compensation", icon: Wallet, keys: "G M", keywords: ["bonus", "run", "payroll", "deferred", "clawback"], pay: true },
  { href: "/people", label: "People", icon: UserCheck, keys: "G P", keywords: ["hr", "eligibility", "employees", "probation", "directory"] },
  { href: "/me", label: "My compensation", icon: CircleUser, keys: "G Y", keywords: ["my bonus", "payslip", "me", "statement"] },
  { href: "/policy", label: "Policy", icon: BookOpen, keys: "G K", keywords: ["handbook", "rules", "initiative policy"] },
  { href: "/me/company", label: "Company results", icon: Landmark, keywords: ["§9.6", "financial summary", "monthly results", "company performance"] },
  { href: "/disputes", label: "Disputes", icon: Gavel, keys: "G X", keywords: ["§14", "appeal", "complaint", "objection"] },
  { href: "/automation", label: "Automation", icon: Workflow, keys: "G A", keywords: ["workflows", "sequences", "templates", "whatsapp", "email"] },
  { href: "/settings", label: "Settings", icon: Settings, keywords: ["preferences", "workspace", "admin", "sync"] },
];

const RECORD_ROUTE = /^\/(contacts|companies|deals|tickets|initiatives|projects)\/([^/]+)$/;

type Page =
  | { kind: "dealStage"; dealId: string }
  | { kind: "owner"; record: "deal" | "contact" | "company" | "ticket"; id: string }
  | { kind: "closeDate"; dealId: string }
  | { kind: "lifecycle"; contactId: string }
  | { kind: "ticketStage"; ticketId: string }
  | { kind: "ticketPriority"; ticketId: string }
  | { kind: "person"; userId: string }
  | { kind: "jiraProject"; projectId: string };

const PAGE_PLACEHOLDER: Record<Page["kind"], string> = {
  dealStage: "Move the deal to…",
  owner: "Assign to…",
  closeDate: "Pick a close date, or type one (2026-12-20 or 20/12/2026)",
  lifecycle: "Lifecycle stage…",
  ticketStage: "Move the ticket to…",
  ticketPriority: "Priority…",
  person: "Choose an action",
  jiraProject: "Choose where to go",
};

/* ───────────── close-date shortcuts (WIB days) ───────────── */

const dayMs = 86_400_000;
const keyPlus = (key: string, days: number) => new Date(Date.parse(`${key}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10);
const endOfMonthKey = (key: string, monthsAhead: number) => {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + monthsAhead + 1, 0)).toISOString().slice(0, 10);
};
function closeDateOptions(): { label: string; key: string }[] {
  const today = todayInput();
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  const friday = keyPlus(today, (5 - dow + 7) % 7);
  const [, m] = today.split("-").map(Number) as [number, number];
  const quarterEnd = endOfMonthKey(today, 2 - ((m - 1) % 3));
  return [
    { label: "Today", key: today },
    { label: "End of this week (Fri)", key: friday },
    { label: "End of this month", key: endOfMonthKey(today, 0) },
    { label: "End of next month", key: endOfMonthKey(today, 1) },
    { label: "End of this quarter", key: quarterEnd },
    { label: "In 30 days", key: keyPlus(today, 30) },
    { label: "In 90 days", key: keyPlus(today, 90) },
  ];
}
/** "2026-12-20", "20/12/2026", "20-12-2026", "20/12" (this year) → "yyyy-mm-dd" or null */
function typedDate(q: string): string | null {
  const t = q.trim();
  if (isDateInput(t)) return t;
  const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(t);
  if (!m) return null;
  const year = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : todayInput().slice(0, 4);
  const key = `${year}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return isDateInput(key) ? key : null;
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const openDialog = useUi((s) => s.openDialog);
  const openIssue = useUi((s) => s.openIssue);
  const router = useRouter();
  const pathname = usePathname();
  const access = useAccess();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [registering, setRegistering] = useState(false);

  const contacts = useCrm((s) => s.contacts);
  const companies = useCrm((s) => s.companies);
  const deals = useCrm((s) => s.deals);
  const tickets = useCrm((s) => s.tickets);
  const issues = useCrm((s) => s.issues);
  const pipelines = useCrm((s) => s.pipelines);
  const initiatives = useCrm((s) => s.initiatives);
  const initiativeMembers = useCrm((s) => s.initiativeMembers);
  const users = useCrm((s) => s.users);
  const projects = useCrm((s) => s.projects);
  const currentUserId = useCrm((s) => s.currentUserId);

  const stageName = useMemo(() => new Map(pipelines.flatMap((p) => p.stages.map((s) => [s.id, s.name] as const))), [pipelines]);
  const companyName = useMemo(() => new Map(companies.map((c) => [c.id, c.name] as const)), [companies]);
  const userName = useMemo(() => new Map(users.map((u) => [u.id, u.name] as const)), [users]);
  const current = recordFromPath(pathname);
  const navItems = useMemo(() => NAV_ITEMS.filter((n) => !n.pay || access.seeAllPay), [access.seeAllPay]);

  const currentDeal = current?.type === "deal" ? deals.find((d) => d.id === current.id) : undefined;
  const currentTicket = current?.type === "ticket" ? tickets.find((t) => t.id === current.id) : undefined;
  const currentContact = current?.type === "contact" ? contacts.find((c) => c.id === current.id) : undefined;
  const currentCompany = current?.type === "company" ? companies.find((c) => c.id === current.id) : undefined;

  // project (Jira) of the agile page we're on, from ?project=
  const [projectParam, setProjectParam] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    try {
      setProjectParam(new URL(window.location.href).searchParams.get("project"));
    } catch {
      setProjectParam(null);
    }
  }, [open, pathname]);
  const pageProject = useMemo(() => {
    if (!projectParam) return undefined;
    const v = projectParam.toLowerCase();
    return projects.find((p) => p.id.toLowerCase() === v || p.key.toLowerCase() === v);
  }, [projects, projectParam]);

  // recents are written by useRecentTracker (always mounted); re-read each time the palette opens
  const [visits, setVisits] = useState<RecentVisit[]>([]);
  useEffect(() => {
    if (open) setVisits(readRecent());
  }, [open]);

  const recent = useMemo(() => {
    const out: { path: string; label: string; detail: string; icon: LucideIcon; iconCls: string }[] = [];
    for (const v of visits) {
      if (v.path === pathname) continue;
      const nav = navItems.find((n) => n.href === v.path);
      if (nav) {
        out.push({ path: v.path, label: nav.label, detail: "Page", icon: nav.icon, iconCls: "text-sg-muted" });
        continue;
      }
      const m = v.path.match(RECORD_ROUTE);
      if (!m) continue;
      const id = decodeURIComponent(m[2]!);
      if (m[1] === "contacts") {
        const c = contacts.find((x) => x.id === id);
        if (c) out.push({ path: v.path, label: `${c.firstName} ${c.lastName}`, detail: "Contact", icon: User, iconCls: "text-soft-blue" });
      } else if (m[1] === "companies") {
        const c = companies.find((x) => x.id === id);
        if (c) out.push({ path: v.path, label: c.name, detail: "Company", icon: Building2, iconCls: "text-soft-orange" });
      } else if (m[1] === "deals") {
        const d = deals.find((x) => x.id === id);
        if (d) out.push({ path: v.path, label: d.name, detail: "Deal", icon: Handshake, iconCls: "text-soft-yellow" });
      } else if (m[1] === "tickets") {
        const t = tickets.find((x) => x.id === id);
        if (t) out.push({ path: v.path, label: `${t.id.toUpperCase()} · ${t.subject}`, detail: "Ticket", icon: Ticket, iconCls: "text-soft-red" });
      } else if (m[1] === "projects") {
        const i = initiatives.find((x) => x.id === id);
        if (i) out.push({ path: v.path, label: i.title, detail: "Project register", icon: ClipboardList, iconCls: "text-soft-cyan" });
      } else if (id === "new") {
        out.push({ path: v.path, label: "New initiative proposal", detail: "Page", icon: Briefcase, iconCls: "text-soft-green" });
      } else {
        const i = initiatives.find((x) => x.id === id);
        if (i) out.push({ path: v.path, label: i.title, detail: "Initiative", icon: Briefcase, iconCls: "text-soft-green" });
      }
    }
    return out;
  }, [visits, pathname, navItems, contacts, companies, deals, tickets, initiatives]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setPage(null);
  };
  const go = (href: string) => {
    close();
    router.push(href);
  };
  const enter = (p: Page) => {
    setPage(p);
    setQuery("");
  };
  const back = () => {
    setPage(null);
    setQuery("");
  };

  // only render record results once the user types — keeps the default view a tidy action menu
  const q = query.trim();
  const searching = !page && q.length > 0;

  /* ───────────── capped, ranked record results ───────────── */
  const results = useMemo(() => {
    if (!searching) return null;
    const contactPhone = (c: (typeof contacts)[number]) => [c.phone, ...phoneKeywords(c.phone)];
    return {
      deals: topMatches(deals, q, (d) => ({ value: `deal ${d.id} ${d.name}`, keywords: [companyName.get(d.companyId ?? "") ?? "", d.capability] }), GROUP_LIMIT),
      contacts: topMatches(contacts, q, (c) => ({ value: `contact ${c.id} ${c.firstName} ${c.lastName}`, keywords: [c.email, c.jobTitle, companyName.get(c.companyId ?? "") ?? "", ...contactPhone(c)] }), GROUP_LIMIT),
      companies: topMatches(companies, q, (c) => ({ value: `company ${c.id} ${c.name}`, keywords: [c.domain, c.industry, c.city, ...phoneKeywords(c.phone)] }), GROUP_LIMIT),
      tickets: topMatches(tickets, q, (t) => ({ value: `ticket ${t.id} ${t.subject}`, keywords: [companyName.get(t.companyId ?? "") ?? "", t.category, t.id.replace("-", "")] }), GROUP_LIMIT),
      initiatives: topMatches(initiatives, q, (i) => ({ value: `initiative ${i.id} ${i.code ?? i.trackingNo ?? ""} ${i.title}`, keywords: [companyName.get(i.companyId ?? "") ?? "", PROJECT_TYPE_META[i.type].short, initiativeStatusMeta[i.status].label] }), GROUP_LIMIT),
      register: topMatches(
        initiatives.filter((i) => !i.demo && (LIVE_PROJECT_STATUSES as readonly string[]).includes(i.status)),
        q,
        (i) => ({ value: `project register ${i.code ?? ""} ${i.title}`, keywords: ["ongoing", companyName.get(i.companyId ?? "") ?? ""] }),
        GROUP_LIMIT,
      ),
      jira: topMatches(projects, q, (p) => ({ value: `jira project ${p.key} ${p.name}`, keywords: [p.description, "board", "backlog"] }), GROUP_LIMIT),
      people: topMatches(users, q, (u) => ({ value: `person ${u.name}`, keywords: [u.email, u.title, u.team, "people", "colleague"] }), GROUP_LIMIT),
      issues: topMatches(issues, q, (i) => ({ value: `issue ${i.key} ${i.summary}`, keywords: i.labels }), GROUP_LIMIT),
    };
  }, [searching, q, deals, contacts, companies, tickets, initiatives, projects, users, issues, companyName]);

  const seeAll = (label: string, href: string, total: number, shown: number) =>
    total > shown ? (
      <Command.Item value={`see all ${label}`} keywords={[q]} onSelect={() => go(href)} className={cn(itemCls, "text-sg-muted")}>
        <ArrowRight className="size-4 shrink-0 text-sg-dim" />
        See all {total} in {label}
      </Command.Item>
    ) : null;

  /* ───────────── record-action helpers ───────────── */
  const undoable = (message: string, run: () => void) => toast(message, { tone: "success", action: { label: "Undo", run } });

  const setOwner = (record: "deal" | "contact" | "company" | "ticket", id: string, ownerId: string) => {
    const s = useCrm.getState();
    const who = userName.get(ownerId) ?? "someone";
    close();
    if (record === "deal") {
      applyDealChange(id, { ownerId }, `Owner → ${who}`);
    } else if (record === "contact") {
      const before = s.contacts.find((c) => c.id === id)?.ownerId;
      if (!before || before === ownerId) return;
      s.updateContact(id, { ownerId });
      undoable(`Contact owner → ${who}`, () => useCrm.getState().updateContact(id, { ownerId: before }));
    } else if (record === "company") {
      const before = s.companies.find((c) => c.id === id)?.ownerId;
      if (!before || before === ownerId) return;
      s.updateCompany(id, { ownerId });
      undoable(`Company owner → ${who}`, () => useCrm.getState().updateCompany(id, { ownerId: before }));
    } else {
      const before = s.tickets.find((t) => t.id === id)?.ownerId;
      if (!before || before === ownerId) return;
      s.updateTicket(id, { ownerId });
      undoable(`Ticket assigned to ${who}`, () => useCrm.getState().updateTicket(id, { ownerId: before }));
    }
  };

  const moveTicketTo = (ticketId: string, stageId: string) => {
    const s = useCrm.getState();
    const t = s.tickets.find((x) => x.id === ticketId);
    close();
    if (!t || t.stageId === stageId) return;
    const name = stageName.get(stageId) ?? "stage";
    // the service-desk move pauses / resumes the SLA in "Waiting on customer" and can be undone exactly
    const undo = s.moveServiceTicket ? s.moveServiceTicket(ticketId, stageId) : null;
    if (undo) {
      undoable(`${t.id.toUpperCase()} → ${name}`, () => useCrm.getState().undoTicketMove(undo));
    } else {
      s.moveTicket(ticketId, stageId);
      toast(`${t.id.toUpperCase()} → ${name}`, { tone: "success" });
    }
  };

  const whatsApp = (contactId: string) => {
    const s = useCrm.getState();
    const c = s.contacts.find((x) => x.id === contactId);
    const e164 = normalizePhone(c?.phone);
    close();
    if (!c || !e164) {
      toast("This contact has no phone number", { tone: "warn" });
      return;
    }
    window.open(`https://wa.me/${e164.slice(1)}`, "_blank", "noopener,noreferrer");
    s.logWhatsApp?.(contactId);
  };

  const copy = (text: string, what: string) => {
    close();
    void navigator.clipboard?.writeText(text).then(
      () => toast(`${what} copied`, { tone: "success" }),
      () => toast(`Couldn't copy the ${what.toLowerCase()}`, { tone: "warn" }),
    );
  };

  /* ───────────── sub-pages ───────────── */
  const renderPage = (p: Page) => {
    const backItem = (
      <Command.Item value="back to all commands" keywords={["return", "esc"]} onSelect={back} className={cn(itemCls, "text-sg-muted")}>
        <ArrowLeft className="size-4 shrink-0 text-sg-dim" /> Back
        <Kbd className="ml-auto">⌫</Kbd>
      </Command.Item>
    );
    switch (p.kind) {
      case "dealStage": {
        const deal = deals.find((d) => d.id === p.dealId);
        const pipeline = pipelines.find((x) => x.id === deal?.pipelineId);
        return (
          <Command.Group heading={deal ? `Stage · ${deal.name}` : "Stage"} className={groupCls}>
            {pipeline?.stages.map((st) => (
              <Command.Item
                key={st.id}
                value={`stage ${st.name}`}
                disabled={st.id === deal?.stageId}
                onSelect={() => {
                  close();
                  if (deal) requestDealStage(deal.id, st.id);
                }}
                className={itemCls}
              >
                {st.closed === "won" ? <CircleCheck className="size-4 text-soft-green" /> : st.closed === "lost" ? <CircleX className="size-4 text-soft-red" /> : <Target className="size-4 text-sg-muted" />}
                {st.name}
                <span className="ml-auto text-xs text-sg-dim">{st.id === deal?.stageId ? "current" : st.closed ? "asks for the outcome" : `${Math.round(st.probability * 100)}%`}</span>
              </Command.Item>
            ))}
            {backItem}
          </Command.Group>
        );
      }
      case "owner": {
        const currentOwner =
          p.record === "deal" ? deals.find((d) => d.id === p.id)?.ownerId : p.record === "contact" ? contacts.find((c) => c.id === p.id)?.ownerId : p.record === "company" ? companies.find((c) => c.id === p.id)?.ownerId : tickets.find((t) => t.id === p.id)?.ownerId;
        const ordered = [...users].sort((a, b) => Number(b.id === currentUserId) - Number(a.id === currentUserId) || a.name.localeCompare(b.name));
        return (
          <Command.Group heading="Assign to" className={groupCls}>
            {ordered.map((u) => (
              <Command.Item key={u.id} value={`owner ${u.name}`} keywords={[u.title, u.team, u.email]} disabled={u.id === currentOwner} onSelect={() => setOwner(p.record, p.id, u.id)} className={itemCls}>
                <User className="size-4 text-soft-blue" />
                {u.name}
                {u.id === currentUserId ? <span className="text-xs text-sg-dim">(me)</span> : null}
                <span className="ml-auto truncate text-xs text-sg-dim">{u.id === currentOwner ? "current owner" : `${u.title} · ${u.team}`}</span>
              </Command.Item>
            ))}
            {backItem}
          </Command.Group>
        );
      }
      case "closeDate": {
        const deal = deals.find((d) => d.id === p.dealId);
        const typed = typedDate(query);
        const set = (key: string) => {
          close();
          if (deal) applyDealChange(deal.id, { closeDate: fromDateInput(key) }, `Close date → ${formatDate(fromDateInput(key), "medium")}`);
        };
        return (
          <Command.Group heading={deal ? `Close date · now ${formatDate(deal.closeDate, "medium")}` : "Close date"} className={groupCls}>
            {typed ? (
              <Command.Item value={`date typed ${query}`} keywords={[query]} onSelect={() => set(typed)} className={itemCls}>
                <CalendarDays className="size-4 text-soft-cyan" /> Set to {formatDate(fromDateInput(typed), "long")}
              </Command.Item>
            ) : null}
            {closeDateOptions().map((o) => (
              <Command.Item key={o.label} value={`date ${o.label}`} onSelect={() => set(o.key)} className={itemCls}>
                <CalendarDays className="size-4 text-sg-muted" /> {o.label}
                <span className="ml-auto text-xs text-sg-dim">{formatDate(fromDateInput(o.key), "long")}</span>
              </Command.Item>
            ))}
            {backItem}
          </Command.Group>
        );
      }
      case "lifecycle": {
        const c = contacts.find((x) => x.id === p.contactId);
        return (
          <Command.Group heading="Lifecycle stage" className={groupCls}>
            {(Object.keys(lifecycleMeta) as LifecycleStage[]).map((stage) => (
              <Command.Item
                key={stage}
                value={`lifecycle ${lifecycleMeta[stage].label}`}
                disabled={c?.lifecycleStage === stage}
                onSelect={() => {
                  close();
                  if (!c) return;
                  const before = c.lifecycleStage;
                  useCrm.getState().updateContact(c.id, { lifecycleStage: stage });
                  undoable(`${c.firstName} ${c.lastName} → ${lifecycleMeta[stage].label}`, () => useCrm.getState().updateContact(c.id, { lifecycleStage: before }));
                }}
                className={itemCls}
              >
                <span aria-hidden className={cn("size-2 rounded-full bg-current", softText[lifecycleMeta[stage].color])} />
                {lifecycleMeta[stage].label}
                {c?.lifecycleStage === stage ? <span className="ml-auto text-xs text-sg-dim">current</span> : null}
              </Command.Item>
            ))}
            {backItem}
          </Command.Group>
        );
      }
      case "ticketStage": {
        const t = tickets.find((x) => x.id === p.ticketId);
        const pipeline = pipelines.find((x) => x.id === t?.pipelineId);
        return (
          <Command.Group heading={t ? `Status · ${t.id.toUpperCase()}` : "Status"} className={groupCls}>
            {pipeline?.stages.map((st) => (
              <Command.Item key={st.id} value={`status ${st.name}`} disabled={st.id === t?.stageId} onSelect={() => moveTicketTo(p.ticketId, st.id)} className={itemCls}>
                {st.closed ? <CircleCheck className="size-4 text-soft-green" /> : <Target className="size-4 text-sg-muted" />}
                {st.name}
                {st.id === t?.stageId ? <span className="ml-auto text-xs text-sg-dim">current</span> : null}
              </Command.Item>
            ))}
            {backItem}
          </Command.Group>
        );
      }
      case "ticketPriority": {
        const t = tickets.find((x) => x.id === p.ticketId);
        return (
          <Command.Group heading="Priority" className={groupCls}>
            {(Object.keys(ticketPriorityMeta) as TicketPriority[]).map((pr) => (
              <Command.Item
                key={pr}
                value={`priority ${ticketPriorityMeta[pr].label}`}
                disabled={t?.priority === pr}
                onSelect={() => {
                  close();
                  if (!t) return;
                  const before = t.priority;
                  useCrm.getState().updateTicket(t.id, { priority: pr });
                  undoable(`${t.id.toUpperCase()} priority → ${ticketPriorityMeta[pr].label} · SLA deadline unchanged`, () => useCrm.getState().updateTicket(t.id, { priority: before }));
                }}
                className={itemCls}
              >
                <span aria-hidden className={cn("size-2 rounded-full bg-current", softText[ticketPriorityMeta[pr].color])} />
                {ticketPriorityMeta[pr].label}
                {t?.priority === pr ? <span className="ml-auto text-xs text-sg-dim">current</span> : null}
              </Command.Item>
            ))}
            {backItem}
          </Command.Group>
        );
      }
      case "person": {
        const u = users.find((x) => x.id === p.userId);
        if (!u) return backItem;
        const memberships = initiativeMembers
          .filter((m) => m.userId === u.id && !m.leftAt)
          .map((m) => ({ m, i: initiatives.find((x) => x.id === m.initiativeId) }))
          .filter((x): x is { m: (typeof initiativeMembers)[number]; i: (typeof initiatives)[number] } => !!x.i && !x.i.demo);
        const assigned = issues.filter((i) => i.assigneeId === u.id && i.status !== "done").length;
        return (
          <>
            <div className="mx-2.5 mb-1 mt-2 rounded-lg border border-sg-line bg-sg-bg/40 px-3 py-2">
              <div className="text-sm font-semibold text-sg-white">{u.name}</div>
              <div className="text-xs text-sg-muted">
                {u.title} · {u.team}
              </div>
              <div className="mt-0.5 text-xs text-sg-dim">
                {u.email} · {assigned} open issue{assigned === 1 ? "" : "s"}
              </div>
            </div>
            <Command.Group heading="Actions" className={groupCls}>
              <Command.Item
                value="person email"
                onSelect={() => {
                  close();
                  window.location.href = `mailto:${u.email}`;
                }}
                className={itemCls}
              >
                <Mail className="size-4 text-soft-blue" /> Email {u.name.split(" ")[0]}
              </Command.Item>
              <Command.Item value="person copy email" onSelect={() => copy(u.email, "Email address")} className={itemCls}>
                <Copy className="size-4 text-sg-muted" /> Copy email address
              </Command.Item>
              <Command.Item value="person open issues" onSelect={() => go(`/issues?q=${encodeURIComponent(`assignee:${u.id === currentUserId ? "me" : (u.name.split(" ")[0] ?? u.name).toLowerCase()}`)}`)} className={itemCls}>
                <ListTodo className="size-4 text-soft-cyan" /> Open issues assigned to {u.name.split(" ")[0]}
              </Command.Item>
              {u.id === currentUserId ? (
                <Command.Item value="person my compensation" onSelect={() => go("/me")} className={itemCls}>
                  <CircleUser className="size-4 text-soft-green" /> My compensation
                </Command.Item>
              ) : null}
              <Command.Item value="person people register" onSelect={() => go("/people")} className={itemCls}>
                <UserCheck className="size-4 text-sg-muted" /> {access.seeAllPay || access.manageHr ? "Open the People register" : "Open the directory"}
              </Command.Item>
            </Command.Group>
            {memberships.length ? (
              <Command.Group heading="Project roles" className={groupCls}>
                {memberships.map(({ m, i }) => (
                  <Command.Item key={m.id} value={`person project ${i.title}`} onSelect={() => go((LIVE_PROJECT_STATUSES as readonly string[]).includes(i.status) ? `/projects/${i.id}` : `/initiatives/${i.id}`)} className={itemCls}>
                    <Briefcase className="size-4 shrink-0 text-soft-green" />
                    <span className="truncate">{i.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-sg-dim">{m.roles.map((r) => ROLE_META[r].label).join(", ")}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            <Command.Group className={groupCls}>{backItem}</Command.Group>
          </>
        );
      }
      case "jiraProject": {
        const pr = projects.find((x) => x.id === p.projectId);
        if (!pr) return backItem;
        return (
          <Command.Group heading={`${pr.key} · ${pr.name}`} className={groupCls}>
            <Command.Item value="project board" onSelect={() => go(`/board?project=${encodeURIComponent(pr.key)}`)} className={itemCls}>
              <Kanban className="size-4 text-soft-cyan" /> Board <Kbd className="ml-auto">G B</Kbd>
            </Command.Item>
            <Command.Item value="project backlog" onSelect={() => go(`/backlog?project=${encodeURIComponent(pr.key)}`)} className={itemCls}>
              <ListChecks className="size-4 text-sg-muted" /> Backlog & sprints
            </Command.Item>
            <Command.Item value="project issues" onSelect={() => go(`/issues?project=${encodeURIComponent(pr.key)}`)} className={itemCls}>
              <ListTodo className="size-4 text-sg-muted" /> All issues
            </Command.Item>
            <Command.Item
              value="project create issue"
              onSelect={() => {
                close();
                openDialog({ kind: "createIssue", projectId: pr.id });
              }}
              className={itemCls}
            >
              <Plus className="size-4 text-soft-cyan" /> Create issue in {pr.key}
            </Command.Item>
            {backItem}
          </Command.Group>
        );
      }
    }
  };

  const recordLabel = currentDeal ? currentDeal.name : currentTicket ? `${currentTicket.id.toUpperCase()} · ${currentTicket.subject}` : currentContact ? `${currentContact.firstName} ${currentContact.lastName}` : currentCompany?.name;
  const wonStage = currentDeal ? pipelines.find((p) => p.id === currentDeal.pipelineId)?.stages.find((s) => s.closed === "won") : undefined;
  const lostStage = currentDeal ? pipelines.find((p) => p.id === currentDeal.pipelineId)?.stages.find((s) => s.closed === "lost") : undefined;
  const dealClosed = !!currentDeal && !!pipelines.flatMap((p) => p.stages).find((s) => s.id === currentDeal.stageId)?.closed;

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            onEscapeKeyDown={(e) => {
              // Esc steps out of a sub-page first
              if (page) {
                e.preventDefault();
                back();
              }
            }}
            // centred with inset-x-0 + mx-auto (no translate) so the zoom-in animation can't push it sideways
            className="fixed inset-x-0 top-[calc(8vh+env(safe-area-inset-top))] z-50 mx-auto w-[min(640px,calc(100vw-24px))] overflow-hidden rounded-xl border border-sg-line bg-sg-card shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:top-[14vh]"
          >
            <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Search records or run an action</DialogPrimitive.Description>
            <div className="sg-spectrum-rule h-[2px]" />
            <Command
              label="Command palette"
              loop
              filter={tokenFilter}
              className="flex flex-col"
              onKeyDown={(e) => {
                if (e.key === "Backspace" && page && !query) {
                  e.preventDefault();
                  back();
                }
              }}
            >
              <div className="flex items-center gap-2 border-b border-sg-line px-4">
                {page ? (
                  <button type="button" onClick={back} aria-label="Back to all commands" className="-ml-1 rounded p-1 text-sg-dim hover:bg-sg-card-2 hover:text-sg-white">
                    <ArrowLeft className="size-4" />
                  </button>
                ) : null}
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  autoFocus
                  placeholder={page ? PAGE_PLACEHOLDER[page.kind] : "Search records, people, projects — or type a command"}
                  className="h-12 min-w-0 flex-1 bg-transparent text-base text-sg-white placeholder:text-sg-dim focus:outline-none"
                />
                <Kbd>esc</Kbd>
              </div>
              <Command.List className="max-h-[min(56vh,calc(100dvh-8rem))] overflow-y-auto overscroll-contain p-2">
                <Command.Empty className="px-3 py-8 text-center text-sm text-sg-muted">
                  {page ? "Nothing matches — Backspace to go back." : "No matches. Try a company, a person, a phone number, a deal or an issue key like UAV-102."}
                </Command.Empty>

                {page ? renderPage(page) : null}

                {!page && !searching && recent.length > 0 && (
                  <Command.Group heading="Recent" className={groupCls}>
                    {recent.map((r) => (
                      <Command.Item key={r.path} value={`recent ${r.path} ${r.label}`} onSelect={() => go(r.path)} className={itemCls}>
                        <r.icon className={cn("size-4 shrink-0", r.iconCls)} />
                        <span className="truncate">{r.label}</span>
                        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-sg-dim">
                          <History className="size-3" aria-hidden />
                          {r.detail}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {!page && recordLabel ? (
                  <Command.Group heading={`This record · ${recordLabel}`} className={groupCls}>
                    {currentDeal ? (
                      <>
                        <Command.Item value="record deal move to stage" keywords={["status", "pipeline", "advance"]} onSelect={() => enter({ kind: "dealStage", dealId: currentDeal.id })} className={itemCls}>
                          <Target className="size-4 text-soft-yellow" /> Move to stage…
                          <span className="ml-auto text-xs text-sg-dim">now {stageName.get(currentDeal.stageId)}</span>
                        </Command.Item>
                        {wonStage && !dealClosed ? (
                          <Command.Item
                            value="record deal mark won"
                            keywords={["close", "win", "closed won"]}
                            onSelect={() => {
                              close();
                              requestDealStage(currentDeal.id, wonStage.id);
                            }}
                            className={itemCls}
                          >
                            <CircleCheck className="size-4 text-soft-green" /> Mark won…
                            <span className="ml-auto text-xs text-sg-dim">close date set to today</span>
                          </Command.Item>
                        ) : null}
                        {lostStage && !dealClosed ? (
                          <Command.Item
                            value="record deal mark lost"
                            keywords={["close", "lose", "closed lost"]}
                            onSelect={() => {
                              close();
                              requestDealStage(currentDeal.id, lostStage.id);
                            }}
                            className={itemCls}
                          >
                            <CircleX className="size-4 text-soft-red" /> Mark lost…
                            <span className="ml-auto text-xs text-sg-dim">asks for the reason</span>
                          </Command.Item>
                        ) : null}
                        <Command.Item value="record deal change owner" keywords={["assign", "reassign"]} onSelect={() => enter({ kind: "owner", record: "deal", id: currentDeal.id })} className={itemCls}>
                          <User className="size-4 text-soft-blue" /> Change owner…
                          <span className="ml-auto text-xs text-sg-dim">{userName.get(currentDeal.ownerId)}</span>
                        </Command.Item>
                        <Command.Item value="record deal set close date" keywords={["expected", "forecast"]} onSelect={() => enter({ kind: "closeDate", dealId: currentDeal.id })} className={itemCls}>
                          <CalendarDays className="size-4 text-soft-cyan" /> Set close date…
                          <span className="ml-auto text-xs text-sg-dim">{formatDate(currentDeal.closeDate, "medium")}</span>
                        </Command.Item>
                        <Command.Item value="record deal propose initiative" keywords={["prc", "handoff", "delivery"]} onSelect={() => go(`/initiatives/new?fromDeal=${encodeURIComponent(currentDeal.id)}`)} className={itemCls}>
                          <Briefcase className="size-4 text-soft-green" /> Propose an initiative from this deal
                        </Command.Item>
                      </>
                    ) : null}
                    {currentTicket ? (
                      <>
                        <Command.Item value="record ticket change status" keywords={["stage", "close", "resolve", "waiting"]} onSelect={() => enter({ kind: "ticketStage", ticketId: currentTicket.id })} className={itemCls}>
                          <Target className="size-4 text-soft-red" /> Change status…
                          <span className="ml-auto text-xs text-sg-dim">now {stageName.get(currentTicket.stageId)}</span>
                        </Command.Item>
                        <Command.Item value="record ticket change priority" keywords={["urgent", "severity"]} onSelect={() => enter({ kind: "ticketPriority", ticketId: currentTicket.id })} className={itemCls}>
                          <Target className="size-4 text-soft-orange" /> Change priority…
                          <span className="ml-auto text-xs text-sg-dim">{ticketPriorityMeta[currentTicket.priority].label}</span>
                        </Command.Item>
                        <Command.Item value="record ticket assign" keywords={["owner", "reassign"]} onSelect={() => enter({ kind: "owner", record: "ticket", id: currentTicket.id })} className={itemCls}>
                          <User className="size-4 text-soft-blue" /> Assign to…
                          <span className="ml-auto text-xs text-sg-dim">{userName.get(currentTicket.ownerId)}</span>
                        </Command.Item>
                        <Command.Item
                          value="record ticket escalate to jira"
                          keywords={["engineering", "issue", "bug"]}
                          onSelect={() => openDialog({ kind: "createIssue", link: { crmType: "ticket", crmId: currentTicket.id, linkType: "escalated_from" } })}
                          className={itemCls}
                        >
                          <Kanban className="size-4 text-soft-cyan" /> Escalate to a Jira issue
                          <Kbd className="ml-auto">C</Kbd>
                        </Command.Item>
                      </>
                    ) : null}
                    {currentContact ? (
                      <>
                        <Command.Item value="record contact lifecycle stage" keywords={["lead", "customer", "mql", "sql"]} onSelect={() => enter({ kind: "lifecycle", contactId: currentContact.id })} className={itemCls}>
                          <Target className="size-4 text-soft-magenta" /> Change lifecycle stage…
                          <span className="ml-auto text-xs text-sg-dim">{lifecycleMeta[currentContact.lifecycleStage].label}</span>
                        </Command.Item>
                        <Command.Item value="record contact change owner" keywords={["assign"]} onSelect={() => enter({ kind: "owner", record: "contact", id: currentContact.id })} className={itemCls}>
                          <User className="size-4 text-soft-blue" /> Change owner…
                          <span className="ml-auto text-xs text-sg-dim">{userName.get(currentContact.ownerId)}</span>
                        </Command.Item>
                        {currentContact.phone ? (
                          <Command.Item value="record contact whatsapp" keywords={["wa", "chat", "message"]} onSelect={() => whatsApp(currentContact.id)} className={itemCls}>
                            <MessageSquare className="size-4 text-soft-green" /> WhatsApp {currentContact.firstName}
                            <span className="ml-auto text-xs text-sg-dim">{normalizePhone(currentContact.phone)}</span>
                          </Command.Item>
                        ) : null}
                        <Command.Item value="record contact create ticket" keywords={["support", "service"]} onSelect={() => go(`/tickets?new=1&contactId=${encodeURIComponent(currentContact.id)}${currentContact.companyId ? `&companyId=${encodeURIComponent(currentContact.companyId)}` : ""}`)} className={itemCls}>
                          <Ticket className="size-4 text-soft-red" /> Open a ticket for {currentContact.firstName}
                        </Command.Item>
                      </>
                    ) : null}
                    {currentCompany ? (
                      <>
                        <Command.Item value="record company change owner" keywords={["assign", "account owner"]} onSelect={() => enter({ kind: "owner", record: "company", id: currentCompany.id })} className={itemCls}>
                          <User className="size-4 text-soft-blue" /> Change account owner…
                          <span className="ml-auto text-xs text-sg-dim">{userName.get(currentCompany.ownerId)}</span>
                        </Command.Item>
                        <Command.Item value="record company create ticket" keywords={["support", "service"]} onSelect={() => go(`/tickets?new=1&companyId=${encodeURIComponent(currentCompany.id)}`)} className={itemCls}>
                          <Ticket className="size-4 text-soft-red" /> Open a ticket for {currentCompany.name}
                        </Command.Item>
                      </>
                    ) : null}
                  </Command.Group>
                ) : null}

                {!page && (
                  <Command.Group heading="Quick actions" className={groupCls}>
                    <Command.Item value="action log call" keywords={["phone", "activity"]} onSelect={() => openDialog({ kind: "logActivity", activityType: "call", target: current })} className={itemCls}>
                      <Phone className="size-4 text-soft-green" /> Log call {current ? <span className="text-sg-dim">on this record</span> : null}
                      <Kbd className="ml-auto">L</Kbd>
                    </Command.Item>
                    <Command.Item
                      value={`action create issue ${pageProject ? `in ${pageProject.key}` : ""}`}
                      keywords={["jira", "bug", "story", "task"]}
                      onSelect={() => openDialog({ kind: "createIssue", projectId: pageProject?.id, link: current ? { crmType: current.type, crmId: current.id, linkType: current.type === "ticket" ? "escalated_from" : "relates_to" } : undefined })}
                      className={itemCls}
                    >
                      <Kanban className="size-4 text-soft-cyan" /> Create issue {pageProject ? <span className="text-sg-dim">in {pageProject.key}</span> : current ? <span className="text-sg-dim">linked to this record</span> : null}
                    </Command.Item>
                    <Command.Item
                      value="action create ticket"
                      keywords={["support", "service", "helpdesk", "complaint"]}
                      onSelect={() => {
                        const companyId = current?.type === "company" ? current.id : current?.type === "contact" ? currentContact?.companyId ?? undefined : current?.type === "deal" ? currentDeal?.companyId ?? undefined : undefined;
                        const contactId = current?.type === "contact" ? current.id : current?.type === "deal" ? currentDeal?.contactIds[0] : undefined;
                        const params = new URLSearchParams({ new: "1" });
                        if (companyId) params.set("companyId", companyId);
                        if (contactId) params.set("contactId", contactId);
                        go(`/tickets?${params.toString()}`);
                      }}
                      className={itemCls}
                    >
                      <Ticket className="size-4 text-soft-red" /> Create ticket {current && current.type !== "ticket" ? <span className="text-sg-dim">for this {current.type}</span> : null}
                    </Command.Item>
                    <Command.Item
                      value="action create deal"
                      keywords={["opportunity", "pipeline"]}
                      onSelect={() =>
                        openDialog({
                          kind: "createDeal",
                          companyId: current?.type === "company" ? current.id : current?.type === "contact" ? currentContact?.companyId ?? undefined : undefined,
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
                    <Command.Item value="action propose project initiative" keywords={["prc", "proposal", "new project", "submit"]} onSelect={() => go("/initiatives/new")} className={itemCls}>
                      <Briefcase className="size-4 text-soft-green" /> Propose project initiative
                    </Command.Item>
                    <Command.Item
                      value="action register ongoing project"
                      keywords={["create project", "new project", "register", "§15.1", "project code"]}
                      onSelect={() => {
                        close();
                        setRegistering(true);
                      }}
                      className={itemCls}
                    >
                      <ClipboardList className="size-4 text-soft-cyan" /> Register an ongoing project
                    </Command.Item>
                  </Command.Group>
                )}

                {!page && (
                  <Command.Group heading="Navigate" className={groupCls}>
                    {navItems.map((n) => (
                      <Command.Item key={n.href} value={`nav ${n.label}`} keywords={n.keywords} onSelect={() => go(n.href)} className={itemCls}>
                        <n.icon className="size-4 text-sg-muted" /> {n.label}
                        {n.keys ? (
                          <span className="ml-auto flex gap-1">
                            {n.keys.split(" ").map((k) => (
                              <Kbd key={k}>{k}</Kbd>
                            ))}
                          </span>
                        ) : null}
                      </Command.Item>
                    ))}
                    <Command.Item value="nav keyboard shortcuts help" onSelect={() => openDialog({ kind: "shortcuts" })} className={itemCls}>
                      <Keyboard className="size-4 text-sg-muted" /> Keyboard shortcuts <Kbd className="ml-auto">?</Kbd>
                    </Command.Item>
                  </Command.Group>
                )}

                {!page && (
                  <Command.Group heading="Actions" className={groupCls}>
                    <Command.Item
                      value="action toggle sidebar"
                      keywords={["collapse", "expand", "navigation", "menu", "drawer"]}
                      onSelect={() => {
                        close();
                        toggleNavigation();
                      }}
                      className={itemCls}
                    >
                      <ChevronsLeft className="size-4 text-sg-muted" /> Toggle sidebar <Kbd className="ml-auto">[</Kbd>
                    </Command.Item>
                  </Command.Group>
                )}

                {results && (
                  <>
                    <Command.Group heading="Deals" className={groupCls}>
                      {results.deals.items.map((d) => (
                        <Command.Item key={d.id} value={`deal ${d.id} ${d.name}`} keywords={[companyName.get(d.companyId ?? "") ?? "", d.capability]} onSelect={() => go(`/deals/${d.id}`)} className={itemCls}>
                          <Handshake className="size-4 shrink-0 text-soft-yellow" />
                          <span className="truncate">{d.name}</span>
                          <span className="ml-auto shrink-0 text-xs text-sg-dim">
                            {stageName.get(d.stageId)} · {formatIDR(d.amount)}
                          </span>
                        </Command.Item>
                      ))}
                      {seeAll("Deals", `/deals?view=table&q=${encodeURIComponent(q)}`, results.deals.total, results.deals.items.length)}
                    </Command.Group>
                    <Command.Group heading="Contacts" className={groupCls}>
                      {results.contacts.items.map((c) => (
                        <Command.Item
                          key={c.id}
                          value={`contact ${c.id} ${c.firstName} ${c.lastName}`}
                          keywords={[c.email, c.jobTitle, companyName.get(c.companyId ?? "") ?? "", c.phone, ...phoneKeywords(c.phone)]}
                          onSelect={() => go(`/contacts/${c.id}`)}
                          className={itemCls}
                        >
                          <User className="size-4 shrink-0 text-soft-blue" />
                          <span className="truncate">
                            {c.firstName} {c.lastName}
                          </span>
                          <span className="truncate text-xs text-sg-dim">{companyName.get(c.companyId ?? "")}</span>
                          <span className="ml-auto shrink-0 text-xs text-sg-dim">{/\d{3}/.test(q) && c.phone ? c.phone : lifecycleMeta[c.lifecycleStage].label}</span>
                        </Command.Item>
                      ))}
                      {seeAll("Contacts", `/contacts?q=${encodeURIComponent(q)}`, results.contacts.total, results.contacts.items.length)}
                    </Command.Group>
                    <Command.Group heading="Companies" className={groupCls}>
                      {results.companies.items.map((c) => (
                        <Command.Item key={c.id} value={`company ${c.id} ${c.name}`} keywords={[c.domain, c.industry, c.city, ...phoneKeywords(c.phone)]} onSelect={() => go(`/companies/${c.id}`)} className={itemCls}>
                          <Building2 className="size-4 shrink-0 text-soft-orange" />
                          <span className="truncate">{c.name}</span>
                          <span className="ml-auto shrink-0 text-xs text-sg-dim">{c.domain}</span>
                        </Command.Item>
                      ))}
                      {seeAll("Companies", `/companies?q=${encodeURIComponent(q)}`, results.companies.total, results.companies.items.length)}
                    </Command.Group>
                    <Command.Group heading="Tickets" className={groupCls}>
                      {results.tickets.items.map((t) => (
                        <Command.Item key={t.id} value={`ticket ${t.id} ${t.subject}`} keywords={[companyName.get(t.companyId ?? "") ?? "", t.category, t.id.replace("-", "")]} onSelect={() => go(`/tickets/${t.id}`)} className={itemCls}>
                          <Ticket className="size-4 shrink-0 text-soft-red" />
                          <span className="shrink-0 font-semibold text-sg-muted">{t.id.toUpperCase()}</span>
                          <span className="truncate">{t.subject}</span>
                          <span className="ml-auto shrink-0 text-xs text-sg-dim">{stageName.get(t.stageId)}</span>
                        </Command.Item>
                      ))}
                      {seeAll("Tickets", `/tickets?view=table&q=${encodeURIComponent(q)}`, results.tickets.total, results.tickets.items.length)}
                    </Command.Group>
                    <Command.Group heading="People" className={groupCls}>
                      {results.people.items.map((u) => (
                        <Command.Item key={u.id} value={`person ${u.name}`} keywords={[u.email, u.title, u.team, "people", "colleague"]} onSelect={() => enter({ kind: "person", userId: u.id })} className={itemCls}>
                          <CircleUser className="size-4 shrink-0 text-soft-magenta" />
                          <span className="truncate">{u.name}</span>
                          <span className="truncate text-xs text-sg-dim">{u.title}</span>
                          <span className="ml-auto shrink-0 text-xs text-sg-dim">{u.team}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                    <Command.Group heading="Projects" className={groupCls}>
                      {results.register.items.map((i) => (
                        <Command.Item key={`reg-${i.id}`} value={`project register ${i.code ?? ""} ${i.title}`} keywords={["ongoing", companyName.get(i.companyId ?? "") ?? ""]} onSelect={() => go(`/projects/${i.id}`)} className={itemCls}>
                          <ClipboardList className="size-4 shrink-0 text-soft-cyan" />
                          {i.code ? <span className="shrink-0 font-semibold text-sg-muted">{i.code}</span> : null}
                          <span className="truncate">{i.title}</span>
                          <span className="ml-auto shrink-0 text-xs text-sg-dim">Project register</span>
                        </Command.Item>
                      ))}
                      {results.jira.items.map((p) => (
                        <Command.Item key={`jira-${p.id}`} value={`jira project ${p.key} ${p.name}`} keywords={[p.description, "board", "backlog"]} onSelect={() => enter({ kind: "jiraProject", projectId: p.id })} className={itemCls}>
                          <Kanban className="size-4 shrink-0 text-soft-cyan" />
                          <span className="shrink-0 font-semibold text-sg-muted">{p.key}</span>
                          <span className="truncate">{p.name}</span>
                          <span className="ml-auto shrink-0 text-xs text-sg-dim">Board · backlog · issues</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                    <Command.Group heading="Initiatives" className={groupCls}>
                      {results.initiatives.items.map((i) => {
                        const ref = i.code ?? i.trackingNo;
                        return (
                          <Command.Item key={i.id} value={`initiative ${i.id} ${i.code ?? i.trackingNo ?? ""} ${i.title}`} keywords={[companyName.get(i.companyId ?? "") ?? "", PROJECT_TYPE_META[i.type].short, initiativeStatusMeta[i.status].label]} onSelect={() => go(`/initiatives/${i.id}`)} className={itemCls}>
                            <Briefcase className="size-4 shrink-0 text-soft-green" />
                            {ref ? <span className="shrink-0 font-semibold text-sg-muted">{ref}</span> : null}
                            <span className="truncate">{i.title}</span>
                            <span className={cn("ml-auto shrink-0 text-xs", softText[initiativeStatusMeta[i.status].color])}>{initiativeStatusMeta[i.status].label}</span>
                          </Command.Item>
                        );
                      })}
                      {seeAll("Initiatives", "/initiatives", results.initiatives.total, results.initiatives.items.length)}
                    </Command.Group>
                    <Command.Group heading="Issues" className={groupCls}>
                      {results.issues.items.map((i) => {
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
                      {seeAll("Issues", `/issues?q=${encodeURIComponent(q)}`, results.issues.total, results.issues.items.length)}
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
                  <Kbd>↵</Kbd> {page ? "choose" : "open"}
                </span>
                {page ? (
                  <span className="flex items-center gap-1">
                    <Kbd>⌫</Kbd> back
                  </span>
                ) : null}
                <span className="ml-auto hidden truncate sm:inline">Contacts · companies · deals · tickets · people · projects · issues · initiatives</span>
              </div>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      {registering ? <RegisterProjectDialog open={registering} onOpenChange={setRegistering} /> : null}
    </>
  );
}
