"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { BookOpen, Briefcase, Building2, ChevronsLeft, ChevronsRight, CircleUser, ClipboardList, Handshake, House, Kanban, Keyboard, ListChecks, ListTodo, Search, Ticket, UserCheck, Users, Wallet, type LucideIcon } from "lucide-react";
import { SidebarExtras } from "./sidebar-extras";
import { NotificationBell } from "./notifications";
import { useCrm, useUi } from "@/lib/store";
import { SMART_LISTS } from "@/lib/smart-lists";
import { cn } from "@/lib/utils";
import { buildRegister, LIVE_PROJECT_STATUSES } from "@/components/projects/model";
import { Avatar, Kbd, SpectrumMark } from "@/components/ui/misc";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  shortcut: string;
  count?: number;
}

export function Sidebar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const openDialog = useUi((s) => s.openDialog);
  const deals = useCrm((s) => s.deals);
  const contacts = useCrm((s) => s.contacts);
  const companies = useCrm((s) => s.companies);
  const issues = useCrm((s) => s.issues);
  const sprints = useCrm((s) => s.sprints);
  const users = useCrm((s) => s.users);
  const currentUserId = useCrm((s) => s.currentUserId);
  const pipelines = useCrm((s) => s.pipelines);
  const initiatives = useCrm((s) => s.initiatives);
  const initiativeMembers = useCrm((s) => s.initiativeMembers);
  const employeeProfiles = useCrm((s) => s.employeeProfiles);
  const revenueEntries = useCrm((s) => s.revenueEntries);
  const curveAdjustments = useCrm((s) => s.curveAdjustments);
  const teamAmendments = useCrm((s) => s.teamAmendments);
  const me = users.find((u) => u.id === currentUserId);

  const counts = useMemo(() => {
    const closed = new Set(pipelines.flatMap((p) => p.stages.filter((s) => s.closed).map((s) => s.id)));
    const active = new Set(sprints.filter((s) => s.state === "active").map((s) => s.id));
    return {
      openDeals: deals.filter((d) => !closed.has(d.stageId)).length,
      contacts: contacts.length,
      companies: companies.length,
      sprintIssues: issues.filter((i) => i.sprintId && active.has(i.sprintId) && i.status !== "done").length,
      awaitingPrc: initiatives.filter((i) => i.status === "submitted" || i.status === "screening" || i.status === "evaluation").length,
    };
  }, [deals, contacts, companies, issues, sprints, pipelines, initiatives]);

  /** §6.5 register: real (non-sample) live projects with their compliance state */
  const ongoing = useMemo(() => {
    const inp = { initiatives, members: initiativeMembers, profiles: employeeProfiles, users, entries: revenueEntries, adjustments: curveAdjustments, amendments: teamAmendments };
    return initiatives
      .filter((i) => !i.demo && (LIVE_PROJECT_STATUSES as readonly string[]).includes(i.status))
      .map((i) => {
        const r = buildRegister(i, inp);
        return { id: i.id, title: i.title, type: i.type, failing: r.failing, people: r.rows.length };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [initiatives, initiativeMembers, employeeProfiles, users, revenueEntries, curveAdjustments, teamAmendments]);

  const revenue: NavItem[] = [
    { href: "/home", label: "Home", icon: House, shortcut: "G H" },
    { href: "/deals", label: "Deals", icon: Handshake, shortcut: "G D", count: counts.openDeals },
    { href: "/contacts", label: "Contacts", icon: Users, shortcut: "G C", count: counts.contacts },
    { href: "/companies", label: "Companies", icon: Building2, shortcut: "G O", count: counts.companies },
    { href: "/tickets", label: "Tickets", icon: Ticket, shortcut: "G T" },
  ];
  const programme: NavItem[] = [
    { href: "/initiatives", label: "Initiatives", icon: Briefcase, shortcut: "G I", count: counts.awaitingPrc },
    { href: "/compensation", label: "Compensation", icon: Wallet, shortcut: "G M" },
    { href: "/people", label: "People", icon: UserCheck, shortcut: "G P" },
    { href: "/me", label: "My compensation", icon: CircleUser, shortcut: "G Y" },
    { href: "/policy", label: "Policy", icon: BookOpen, shortcut: "G K" },
  ];
  const agile: NavItem[] = [
    { href: "/board", label: "Board", icon: Kanban, shortcut: "G B", count: counts.sprintIssues },
    { href: "/backlog", label: "Backlog", icon: ListChecks, shortcut: "G L" },
    { href: "/issues", label: "Issues", icon: ListTodo, shortcut: "G U" },
  ];

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const activeView = params.get("view");

  return (
    <aside className={cn("flex h-full shrink-0 flex-col border-r border-sg-line bg-sg-bg transition-[width] duration-200 ease-sg", collapsed ? "w-[56px]" : "w-[232px]")}>
      <div className={cn("flex h-12 items-center border-b border-sg-line", collapsed ? "justify-center px-0" : "justify-between px-4")}>
        <Link href="/home" className="flex items-center gap-2" aria-label="Spectrum CRM home">
          {collapsed ? (
            <SpectrumMark className="h-4" />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/spectrum-logo.png" alt="Spectrum Group" width={120} height={23} className="h-[23px] w-auto" />
              <span className="rounded-sm border border-sg-line-2 px-1 text-[9px] font-bold uppercase tracking-[0.14em] text-sg-muted">CRM</span>
            </>
          )}
        </Link>
      </div>

      <div className={cn("mx-2 mt-3 flex gap-1", collapsed && "flex-col")}>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className={cn("flex h-8 min-w-0 flex-1 items-center gap-2 rounded border border-sg-line bg-sg-card text-sm text-sg-dim transition-colors hover:border-sg-line-2 hover:text-sg-muted", collapsed ? "justify-center px-0" : "px-2.5")}
        aria-label="Search (Command K)"
      >
        <Search className="size-3.5" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">Search or jump…</span>
            <Kbd>⌘K</Kbd>
          </>
        )}
      </button>
      <NotificationBell collapsed={collapsed} />
      </div>

      <nav className="mt-4 flex-1 space-y-5 overflow-y-auto px-2 pb-4">
        <Section title="Revenue" collapsed={collapsed}>
          {revenue.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} collapsed={collapsed} />
          ))}
          {!collapsed && isActive("/contacts") && (
            <div className="ml-6 mt-1 space-y-px border-l border-sg-line pl-2">
              {SMART_LISTS.map((l) => (
                <Link
                  key={l.id}
                  href={`/contacts?view=${l.id}`}
                  className={cn("block truncate rounded px-2 py-1 text-xs transition-colors", activeView === l.id ? "bg-sg-card-2 text-sg-white" : "text-sg-dim hover:text-sg-white")}
                >
                  {l.name}
                </Link>
              ))}
            </div>
          )}
        </Section>
        <Section title="Initiatives" collapsed={collapsed}>
          {programme.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} collapsed={collapsed} />
          ))}
        </Section>
        <Section title="Ongoing projects" collapsed={collapsed}>
          <NavLink item={{ href: "/projects", label: "Project register", icon: ClipboardList, shortcut: "G J", count: ongoing.length }} active={pathname === "/projects"} collapsed={collapsed} />
          {!collapsed &&
            ongoing.map((p) => {
              const href = `/projects/${p.id}`;
              const on = pathname === href;
              return (
                <Link
                  key={p.id}
                  href={href}
                  title={p.failing ? `${p.failing} policy item${p.failing === 1 ? "" : "s"} to fix` : "Meets the policy"}
                  className={cn("group relative ml-4 flex h-7 items-center gap-2 rounded border-l border-sg-line pl-3 pr-2 text-xs transition-colors", on ? "bg-sg-card-2 text-sg-white" : "text-sg-muted hover:bg-sg-card hover:text-sg-white")}
                >
                  <span className="sg-num w-3 shrink-0 text-2xs font-bold text-sg-dim">{p.type}</span>
                  <span className="flex-1 truncate font-medium">{p.title}</span>
                  <span className="sg-num text-2xs text-sg-dim">{p.people || ""}</span>
                  <span className={cn("size-1.5 shrink-0 rounded-full", p.failing ? "bg-soft-red" : "bg-soft-green")} aria-hidden />
                </Link>
              );
            })}
          <div className={cn("mt-1 gap-px", collapsed ? "flex flex-col" : "ml-4 grid grid-cols-3 border-l border-sg-line pl-1")}>
            {agile.map((item) => {
              const Icon = item.icon;
              const on = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={`${item.label} (${item.shortcut})`}
                  className={cn("flex h-7 min-w-0 items-center gap-1 rounded text-2xs font-medium transition-colors", collapsed ? "justify-center" : "justify-center px-1", on ? "bg-sg-card-2 text-sg-white" : "text-sg-dim hover:bg-sg-card hover:text-sg-white")}
                >
                  <Icon className="size-3.5 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        </Section>
      </nav>

      <div className="space-y-1 border-t border-sg-line p-2">
        <SidebarExtras collapsed={collapsed} />
        {!collapsed && (
          <div className="flex gap-1">
            <button type="button" onClick={() => openDialog({ kind: "shortcuts" })} className="flex h-7 flex-1 items-center gap-2 rounded px-2 text-xs text-sg-dim hover:bg-sg-card hover:text-sg-white">
              <Keyboard className="size-3.5" /> Shortcuts <Kbd className="ml-auto">?</Kbd>
            </button>

          </div>
        )}
        <div className={cn("flex items-center gap-2 rounded px-1 py-1", collapsed && "justify-center")}>
          <Avatar user={me} size="sm" />
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-xs font-semibold text-sg-white">{me?.name}</div>
              <div className="truncate text-2xs text-sg-dim">{me?.title}</div>
            </div>
          )}
          <button type="button" onClick={toggle} className="rounded p-1 text-sg-dim hover:bg-sg-card hover:text-sg-white" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title="Toggle sidebar ( [ )">
            {collapsed ? <ChevronsRight className="size-3.5" /> : <ChevronsLeft className="size-3.5" />}
          </button>
        </div>
      </div>
    </aside>
  );
}

function Section({ title, collapsed, children }: { title: string; collapsed: boolean; children: React.ReactNode }) {
  return (
    <div>
      {!collapsed && <div className="sg-eyebrow mb-1.5 px-2">{title}</div>}
      <div className="space-y-px">{children}</div>
    </div>
  );
}

function NavLink({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? `${item.label} (${item.shortcut})` : undefined}
      className={cn(
        "group relative flex h-8 items-center gap-2.5 rounded text-sm font-medium transition-colors",
        collapsed ? "justify-center" : "px-2",
        active ? "bg-sg-card-2 text-sg-white" : "text-sg-muted hover:bg-sg-card hover:text-sg-white",
      )}
    >
      {active && <span className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-sg-white" />}
      <Icon className="size-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {typeof item.count === "number" && <span className="sg-num text-2xs text-sg-dim">{item.count}</span>}
        </>
      )}
    </Link>
  );
}
