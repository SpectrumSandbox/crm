"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Bell, FileText, History, ListChecks, Sparkles, Workflow } from "lucide-react";
import { useCrm } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Sub-navigation shared by /automation, /automation/sequences and /automation/templates. */
export function AutomationNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const notices = useCrm((s) => s.automationNotices);
  const me = useCrm((s) => s.currentUserId);
  const unread = useMemo(() => notices.filter((n) => n.userId === me && !n.readAt).length, [notices, me]);
  const tab = params.get("tab") ?? "workflows";
  const items = [
    { href: "/automation", label: "Workflows", icon: Workflow, on: (pathname === "/automation" && tab === "workflows") || pathname.startsWith("/automation/workflows") },
    { href: "/automation/sequences", label: "Sequences", icon: ListChecks, on: pathname.startsWith("/automation/sequences") },
    { href: "/automation/templates", label: "Templates", icon: FileText, on: pathname.startsWith("/automation/templates") },
    { href: "/automation?tab=recipes", label: "Recipes", icon: Sparkles, on: pathname === "/automation" && tab === "recipes" },
    { href: "/automation?tab=runs", label: "Run log", icon: History, on: pathname === "/automation" && tab === "runs" },
    { href: "/automation?tab=inbox", label: "Inbox", icon: Bell, on: pathname === "/automation" && tab === "inbox", count: unread },
  ];
  return (
    <nav aria-label="Automation" className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-sg-line px-3 sm:px-4">
      {items.map((it) => (
        <Link
          key={it.label}
          href={it.href}
          aria-current={it.on ? "page" : undefined}
          className={cn(
            "relative -mb-px flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sg-white/60",
            it.on ? "border-sg-white text-sg-white" : "border-transparent text-sg-muted hover:text-sg-white",
          )}
        >
          <it.icon className="size-3.5" aria-hidden />
          {it.label}
          {it.count ? <span className="rounded-sm bg-soft-magenta/20 px-1 text-[10px] text-soft-magenta">{it.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** Small on/off switch (role="switch"). */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70 disabled:opacity-40",
        checked ? "border-soft-green/50 bg-soft-green/30" : "border-sg-line-2 bg-sg-card-3",
      )}
    >
      <span aria-hidden className={cn("absolute size-3.5 rounded-full transition-transform", checked ? "translate-x-[18px] bg-soft-green" : "translate-x-[3px] bg-sg-dim")} />
    </button>
  );
}
