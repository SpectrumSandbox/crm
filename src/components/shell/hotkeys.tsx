"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { create } from "zustand";
import { useUi } from "@/lib/store";

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
const TABLE_ROUTES = ["/contacts", "/companies", "/tickets", "/issues"];
const ISSUE_ROUTES = ["/board", "/backlog", "/issues"];

/** Labels are unique (the help dialog keys rows by label). */
export const SHORTCUTS: Shortcut[] = [
  { keys: ["⌘", "K"], label: "Command palette / global search", group: "General" },
  { keys: ["?"], label: "Keyboard shortcuts", group: "General" },
  { keys: ["["], label: "Collapse / expand sidebar", group: "General" },
  { keys: ["Esc"], label: "Close drawer or dialog", group: "General" },
  { keys: ["/"], label: "Focus the page filter", group: "General" },
  { keys: ["G", "H"], label: "Go to Home", group: "Navigation" },
  { keys: ["G", "D"], label: "Go to Deals", group: "Navigation" },
  { keys: ["G", "C"], label: "Go to Contacts", group: "Navigation" },
  { keys: ["G", "O"], label: "Go to Companies", group: "Navigation" },
  { keys: ["G", "T"], label: "Go to Tickets", group: "Navigation" },
  { keys: ["G", "B"], label: "Go to Agile Board", group: "Navigation" },
  { keys: ["G", "L"], label: "Go to Backlog & Sprints", group: "Navigation" },
  { keys: ["G", "U"], label: "Go to Issues", group: "Navigation" },
  { keys: ["G", "I"], label: "Go to Initiatives", group: "Navigation" },
  { keys: ["G", "M"], label: "Go to Compensation", group: "Navigation" },
  { keys: ["G", "P"], label: "Go to People", group: "Navigation" },
  { keys: ["G", "Y"], label: "Go to My compensation", group: "Navigation" },
  { keys: ["G", "K"], label: "Go to Policy", group: "Navigation" },
  { keys: ["C"], label: "Create (deal / contact / company / issue / initiative — by page)", group: "Create" },
  { keys: ["L"], label: "Log a call", group: "Create" },

  // Agile board
  { keys: ["J", "K"], label: "Next / previous card", group: "Board", routes: ["/board"] },
  { keys: ["H", "L"], label: "Previous / next column", group: "Board", routes: ["/board"] },
  { keys: ["Enter"], label: "Open the focused card", group: "Board", routes: ["/board"] },
  { keys: ["Shift", "←", "→"], label: "Move the focused card to the previous / next column", group: "Board", routes: ["/board"] },

  // List / table views
  { keys: ["J", "K"], label: "Next / previous row", group: "Table", routes: TABLE_ROUTES },
  { keys: ["X"], label: "Select / deselect the current row", group: "Table", routes: TABLE_ROUTES },
  { keys: ["Enter"], label: "Open the current row", group: "Table", routes: TABLE_ROUTES },

  // Record pages
  { keys: ["Alt", "←"], label: "Previous record in the list", group: "Record", routes: RECORD_ROUTES },
  { keys: ["Alt", "→"], label: "Next record in the list", group: "Record", routes: RECORD_ROUTES },

  // Issue drawer
  { keys: ["1", "–", "5"], label: "Set issue status (in the issue drawer)", group: "Issue drawer", routes: ISSUE_ROUTES },
];

function routeMatches(route: string, pathname: string) {
  if (route.endsWith("/*")) return pathname.startsWith(route.slice(0, -1)) && pathname.length > route.length - 1;
  return pathname === route;
}

/** Shortcuts that apply on `pathname`: every global one plus the page-specific ones whose routes match. */
export function shortcutsFor(pathname: string): Shortcut[] {
  return SHORTCUTS.filter((s) => !s.routes || s.routes.some((r) => routeMatches(r, pathname)));
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
        const dest: Record<string, string> = { h: "/home", d: "/deals", c: "/contacts", o: "/companies", t: "/tickets", b: "/board", l: "/backlog", u: "/issues", i: "/initiatives", m: "/compensation", p: "/people", y: "/me", k: "/policy" };
        const to = dest[e.key.toLowerCase()];
        if (to) {
          e.preventDefault();
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
          // on the board, H / L move between columns
          if (ui.issueId || pathname === "/board") return;
          e.preventDefault();
          ui.openDialog({ kind: "logActivity", activityType: "call", target: recordFromPath(pathname) });
          return;
        case "c":
        case "C": {
          if (ui.issueId) return;
          e.preventDefault();
          if (pathname.startsWith("/initiatives")) {
            if (pathname !== "/initiatives/new") router.push("/initiatives/new");
          } else if (pathname.startsWith("/board")) ui.openDialog({ kind: "createIssue" });
          else if (pathname.startsWith("/contacts")) ui.openDialog({ kind: "createContact" });
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

/** "/deals/d-123" → { type: "deal", id: "d-123" } */
export function recordFromPath(pathname: string): { type: "contact" | "company" | "deal" | "ticket"; id: string } | undefined {
  const m = pathname.match(/^\/(contacts|companies|deals|tickets)\/([^/]+)$/);
  if (!m) return undefined;
  const type = ({ contacts: "contact", companies: "company", deals: "deal", tickets: "ticket" } as const)[m[1] as "contacts" | "companies" | "deals" | "tickets"];
  return { type, id: decodeURIComponent(m[2]) };
}
