"use client";

import { useEffect, useId, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { create } from "zustand";
import { useCrm, useUi } from "@/lib/store";
import { can, rolesOf } from "@/lib/access-control";

export interface Shortcut {
  keys: string[];
  label: string;
  group: string;
  /**
   * Pages the shortcut applies to. Omitted = global. "/board" matches that page exactly;
   * "/deals/*" matches any page below /deals (record pages).
   */
  routes?: string[];
}

const RECORD_ROUTES = ["/contacts/*", "/companies/*", "/deals/*", "/tickets/*"];
/** List pages with j / k / x / Enter row navigation (SmartTable on contacts / companies / tickets, the /issues table). */
const TABLE_ROUTES = ["/contacts", "/companies", "/tickets", "/issues"];
const ISSUE_ROUTES = ["/board", "/backlog", "/issues"];
/** CRM pages: "L" logs a call and "C" falls back to Create deal only here. */
const CRM_PREFIXES = ["/home", "/deals", "/contacts", "/companies", "/tickets"];

const isCrmPage = (pathname: string) => CRM_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** Labels are unique within a group (the help dialog keys rows by label). */
export const SHORTCUTS: Shortcut[] = [
  { keys: ["⌘", "K"], label: "Command palette / global search", group: "General" },
  { keys: ["?"], label: "Keyboard shortcuts", group: "General" },
  { keys: ["["], label: "Collapse / expand sidebar", group: "General" },
  { keys: ["Esc"], label: "Close drawer or dialog", group: "General" },
  { keys: ["⌘", "↵"], label: "Submit the open form", group: "General" },
  { keys: ["⌘", "Z"], label: "Undo the last change (while its toast shows)", group: "General" },
  { keys: ["G", "H"], label: "Go to Home", group: "Navigation" },
  { keys: ["G", "D"], label: "Go to Deals", group: "Navigation" },
  { keys: ["G", "C"], label: "Go to Contacts", group: "Navigation" },
  { keys: ["G", "O"], label: "Go to Companies", group: "Navigation" },
  { keys: ["G", "T"], label: "Go to Tickets", group: "Navigation" },
  { keys: ["G", "J"], label: "Go to Ongoing projects", group: "Navigation" },
  { keys: ["G", "B"], label: "Go to Agile Board", group: "Navigation" },
  { keys: ["G", "L"], label: "Go to Backlog & Sprints", group: "Navigation" },
  { keys: ["G", "U"], label: "Go to Issues", group: "Navigation" },
  { keys: ["G", "I"], label: "Go to Initiatives", group: "Navigation" },
  { keys: ["G", "M"], label: "Go to Compensation", group: "Navigation" },
  { keys: ["G", "P"], label: "Go to People", group: "Navigation" },
  { keys: ["G", "Y"], label: "Go to My compensation", group: "Navigation" },
  { keys: ["G", "K"], label: "Go to Policy", group: "Navigation" },
  { keys: ["G", "Q"], label: "Go to Quotes", group: "Navigation" },
  { keys: ["G", "A"], label: "Go to Automation", group: "Navigation" },
  { keys: ["G", "X"], label: "Go to Disputes", group: "Navigation" },

  // Agile board
  { keys: ["J", "K"], label: "Next / previous card", group: "Board", routes: ["/board"] },
  { keys: ["H", "L"], label: "Previous / next column", group: "Board", routes: ["/board"] },
  { keys: ["Enter"], label: "Open the focused card", group: "Board", routes: ["/board"] },
  { keys: ["Shift", "←", "→"], label: "Move the focused card to the previous / next column", group: "Board", routes: ["/board"] },
  { keys: ["Esc"], label: "Clear the card focus", group: "Board", routes: ["/board"] },
  { keys: ["I"], label: "Assign the focused issue to me / unassign", group: "Issue keys", routes: ["/board", "/issues"] },
  { keys: ["P"], label: "Next priority on the focused issue", group: "Issue keys", routes: ["/board", "/issues"] },
  { keys: ["E"], label: "Next estimate on the focused issue", group: "Issue keys", routes: ["/board", "/issues"] },

  // Triage inbox (Board / Backlog → Triage)
  { keys: ["J", "K"], label: "Next / previous request (in the triage inbox)", group: "Triage inbox", routes: ["/board", "/backlog"] },
  { keys: ["1"], label: "Accept into the backlog", group: "Triage inbox", routes: ["/board", "/backlog"] },
  { keys: ["2"], label: "Decline with a reason", group: "Triage inbox", routes: ["/board", "/backlog"] },
  { keys: ["3"], label: "Mark as duplicate", group: "Triage inbox", routes: ["/board", "/backlog"] },
  { keys: ["H"], label: "Snooze", group: "Triage inbox", routes: ["/board", "/backlog"] },

  // List / table views
  { keys: ["J", "K"], label: "Next / previous row", group: "Table", routes: TABLE_ROUTES },
  { keys: ["X"], label: "Select / deselect the current row", group: "Table", routes: TABLE_ROUTES },
  { keys: ["Enter"], label: "Open the current row", group: "Table", routes: TABLE_ROUTES },
  { keys: ["Shift", "X"], label: "Select a range of rows", group: "Table", routes: ["/issues"] },
  { keys: ["Esc"], label: "Clear the selection", group: "Table", routes: ["/issues"] },

  // Record pages
  { keys: ["Alt", "←"], label: "Previous record in the list", group: "Record", routes: RECORD_ROUTES },
  { keys: ["Alt", "→"], label: "Next record in the list", group: "Record", routes: RECORD_ROUTES },

  // Issue drawer (opens from any page)
  { keys: ["1", "–", "5"], label: "Set issue status (while the issue drawer is open)", group: "Issue drawer" },
];

function routeMatches(route: string, pathname: string) {
  if (route.endsWith("/*")) return pathname.startsWith(route.slice(0, -1)) && pathname.length > route.length - 1;
  return pathname === route;
}

/** What "C" does on a page, or null when it does nothing there. */
export function createLabel(pathname: string): string | null {
  if (pathname.startsWith("/initiatives")) return pathname === "/initiatives/new" ? null : "Propose a new initiative";
  if (ISSUE_ROUTES.some((r) => pathname.startsWith(r))) return "Create issue (in the selected project)";
  if (pathname === "/tickets") return "New ticket";
  if (pathname.startsWith("/tickets/")) return "Escalate this ticket to a Jira issue";
  if (pathname.startsWith("/contacts")) return "Create contact";
  if (pathname.startsWith("/companies")) return "Create company";
  if (pathname === "/home" || pathname.startsWith("/deals")) return "Create deal";
  return null;
}

/* ───────────── Page-declared shortcuts ─────────────
 * A page that handles its own keys declares them so the help shows exactly what works there:
 *   usePageShortcuts([{ keys: ["J", "K"], label: "Next / previous row", group: "Table" }]);
 * They apply while the page is mounted (routes are ignored) and replace a static entry with the same group + label. */

const registry = new Map<string, Shortcut[]>();

export function usePageShortcuts(shortcuts: Shortcut[]) {
  const id = useId();
  const sig = shortcuts.map((s) => `${s.group}|${s.label}|${s.keys.join("+")}`).join("\n");
  const ref = useRef(shortcuts);
  ref.current = shortcuts;
  useEffect(() => {
    registry.set(id, ref.current ?? []);
    return () => {
      registry.delete(id);
    };
  }, [id, sig]);
}

/** Shortcuts that apply on `pathname`: global ones, the page's static ones, and whatever mounted pages declared. */
export function shortcutsFor(pathname: string): Shortcut[] {
  const out: Shortcut[] = SHORTCUTS.filter((s) => !s.routes || s.routes.some((r) => routeMatches(r, pathname)));
  // "/" only where there is a filter to focus (the policy handbook handles its own search box)
  const hasFilter = typeof document !== "undefined" && (!!document.querySelector("[data-page-filter]") || pathname === "/policy");
  if (hasFilter) out.splice(4, 0, { keys: ["/"], label: "Focus the page filter", group: "General" });
  const c = createLabel(pathname);
  if (c) out.push({ keys: ["C"], label: c, group: "Create" });
  if (isCrmPage(pathname)) out.push({ keys: ["L"], label: recordFromPath(pathname) ? "Log a call on this record" : "Log a call", group: "Create" });
  for (const list of registry.values()) {
    for (const s of list) {
      const at = out.findIndex((x) => x.group === s.group && x.label === s.label);
      const entry = { keys: s.keys, label: s.label, group: s.group };
      if (at >= 0) out[at] = entry;
      else out.push(entry);
    }
  }
  return out;
}

/* ───────────── Mobile navigation drawer (< lg) ───────────── */

export const COMPACT_QUERY = "(max-width: 1023.98px)";

export function isCompactViewport() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(COMPACT_QUERY).matches;
}

export const useMobileNav = create<{ open: boolean; setOpen: (open: boolean) => void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** "[" / palette "Toggle sidebar": collapses the rail on desktop, opens/closes the drawer below lg. */
export function toggleNavigation() {
  if (isCompactViewport()) {
    const nav = useMobileNav.getState();
    nav.setOpen(!nav.open);
  } else {
    useUi.getState().toggleSidebar();
  }
}

/* ───────────── Recently visited pages (command palette "Recent") ───────────── */

export const RECENT_KEY = "sg-crm-recent";
export const RECENT_LIMIT = 8;
export interface RecentVisit {
  path: string;
  at: string;
}

export function readRecent(): RecentVisit[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is RecentVisit => !!v && typeof v === "object" && typeof (v as RecentVisit).path === "string" && typeof (v as RecentVisit).at === "string").slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function recordVisit(path: string) {
  if (!path || path === "/") return;
  try {
    const next = [{ path, at: new Date().toISOString() }, ...readRecent().filter((v) => v.path !== path)].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable (private mode / quota) — recents are a convenience only
  }
}

/** Tracks pathname changes into localStorage so the palette can offer them while it is still lazy-loading. */
export function useRecentTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) recordVisit(pathname);
  }, [pathname]);
}

/* ───────────── Global key handling ───────────── */

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function useGlobalHotkeys() {
  const router = useRouter();
  const pathname = usePathname();
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!ui.paletteOpen) useMobileNav.getState().setOpen(false);
        ui.setPaletteOpen(!ui.paletteOpen);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || ui.paletteOpen || ui.dialog) return;

      if (pendingG.current) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const dest: Record<string, string> = { h: "/home", d: "/deals", c: "/contacts", o: "/companies", t: "/tickets", b: "/board", l: "/backlog", u: "/issues", i: "/initiatives", m: "/compensation", p: "/people", y: "/me", k: "/policy", j: "/projects", a: "/automation", x: "/disputes", q: "/quotes" };
        const to = dest[e.key.toLowerCase()];
        if (to) {
          e.preventDefault();
          if (to === "/compensation" && !canSeePay()) {
            ui.notify("Compensation is restricted to Finance, HR and the PRC (§13.4) — your own statement is under My compensation (G Y)");
            return;
          }
          router.push(to);
        }
        return;
      }

      switch (e.key) {
        case "g":
        case "G":
          pendingG.current = window.setTimeout(() => (pendingG.current = null), 900);
          return;
        case "?":
          e.preventDefault();
          ui.openDialog({ kind: "shortcuts" });
          return;
        case "[":
          e.preventDefault();
          toggleNavigation();
          return;
        case "/": {
          const filter = document.querySelector<HTMLInputElement>("[data-page-filter]");
          if (filter) {
            e.preventDefault();
            filter.focus();
          }
          return;
        }
        case "l":
        case "L":
          // CRM pages only (on the board, H / L move between columns)
          if (ui.issueId || !isCrmPage(pathname)) return;
          e.preventDefault();
          ui.openDialog({ kind: "logActivity", activityType: "call", target: recordFromPath(pathname) });
          return;
        case "c":
        case "C": {
          if (ui.issueId) return;
          if (pathname.startsWith("/initiatives")) {
            e.preventDefault();
            if (pathname !== "/initiatives/new") router.push("/initiatives/new");
            return;
          }
          if (ISSUE_ROUTES.some((r) => pathname.startsWith(r))) {
            e.preventDefault();
            ui.openDialog({ kind: "createIssue" });
            return;
          }
          // the tickets list opens its own New ticket dialog
          if (pathname === "/tickets") return;
          const rec = recordFromPath(pathname);
          if (rec?.type === "ticket") {
            e.preventDefault();
            ui.openDialog({ kind: "createIssue", link: { crmType: "ticket", crmId: rec.id, linkType: "escalated_from" } });
            return;
          }
          const label = createLabel(pathname);
          if (!label) return;
          e.preventDefault();
          if (pathname.startsWith("/contacts")) ui.openDialog({ kind: "createContact" });
          else if (pathname.startsWith("/companies")) ui.openDialog({ kind: "createCompany" });
          else ui.openDialog({ kind: "createDeal" });
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname]);
}

/** Current viewer may see everyone's pay (§13.4) — read outside React from the store. */
function canSeePay() {
  const s = useCrm.getState();
  return can.seeAllPay(rolesOf(s.currentUserId, s.employeeProfiles));
}

/** "/deals/d-123" → { type: "deal", id: "d-123" } */
export function recordFromPath(pathname: string): { type: "contact" | "company" | "deal" | "ticket"; id: string } | undefined {
  const m = pathname.match(/^\/(contacts|companies|deals|tickets)\/([^/]+)$/);
  if (!m) return undefined;
  const type = ({ contacts: "contact", companies: "company", deals: "deal", tickets: "ticket" } as const)[m[1] as "contacts" | "companies" | "deals" | "tickets"];
  return { type, id: decodeURIComponent(m[2]) };
}
