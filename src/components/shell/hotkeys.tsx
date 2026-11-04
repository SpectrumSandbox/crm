"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUi } from "@/lib/store";

export const SHORTCUTS: { keys: string[]; label: string; group: string }[] = [
  { keys: ["⌘", "K"], label: "Command palette / global search", group: "General" },
  { keys: ["?"], label: "Keyboard shortcuts", group: "General" },
  { keys: ["["], label: "Collapse / expand sidebar", group: "General" },
  { keys: ["Esc"], label: "Close drawer or dialog", group: "General" },
  { keys: ["G", "D"], label: "Go to Deals", group: "Navigation" },
  { keys: ["G", "C"], label: "Go to Contacts", group: "Navigation" },
  { keys: ["G", "O"], label: "Go to Companies", group: "Navigation" },
  { keys: ["G", "B"], label: "Go to Agile Board", group: "Navigation" },
  { keys: ["C"], label: "Create (deal / contact / company / issue — by page)", group: "Create" },
  { keys: ["L"], label: "Log a call", group: "Create" },
  { keys: ["/"], label: "Focus the page filter", group: "Create" },
];

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
        ui.setPaletteOpen(!ui.paletteOpen);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || ui.paletteOpen || ui.dialog) return;

      if (pendingG.current) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const dest: Record<string, string> = { d: "/deals", c: "/contacts", o: "/companies", b: "/board" };
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
          ui.toggleSidebar();
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
          if (ui.issueId) return;
          e.preventDefault();
          ui.openDialog({ kind: "logActivity", activityType: "call", target: recordFromPath(pathname) });
          return;
        case "c":
        case "C": {
          if (ui.issueId) return;
          e.preventDefault();
          if (pathname.startsWith("/board")) ui.openDialog({ kind: "createIssue" });
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
