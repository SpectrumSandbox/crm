"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const APP_TITLE = "Spectrum CRM";

function applyTitle(text: string | null | undefined) {
  const t = text?.replace(/\s+/g, " ").trim();
  document.title = t ? `${t} · ${APP_TITLE}` : APP_TITLE;
}

export function PageHeader({
  title,
  docTitle,
  crumbs,
  children,
  meta,
  className,
}: {
  title: React.ReactNode;
  /** Browser-tab title when `title` is not a plain string (record pages). Falls back to the heading's text. */
  docTitle?: string;
  crumbs?: { href: string; label: string }[];
  children?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const plain = docTitle ?? (typeof title === "string" || typeof title === "number" ? String(title) : null);

  useEffect(() => {
    if (plain !== null) {
      applyTitle(plain);
      return;
    }
    // ReactNode title (e.g. <RecordTitle/>): mirror the rendered heading text, which may change after data loads
    const el = h1.current;
    if (!el) return;
    applyTitle(el.textContent);
    const mo = new MutationObserver(() => applyTitle(el.textContent));
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [plain]);

  // reset when the page unmounts so a page without a header doesn't inherit a stale title
  useEffect(() => () => applyTitle(null), []);

  return (
    <header className={cn("flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-sg-line px-4 py-2 sm:px-5", className)}>
      <div className="flex min-w-0 items-center gap-2">
        {crumbs?.length ? (
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2">
            {crumbs.map((c) => (
              <span key={c.href} className="flex items-center gap-2 text-sm text-sg-dim">
                <Link href={c.href} className="rounded-sm hover:text-sg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sg-white/60">
                  {c.label}
                </Link>
                <ChevronRight className="size-3.5" aria-hidden />
              </span>
            ))}
          </nav>
        ) : null}
        <h1 ref={h1} className="truncate font-display text-lg font-extrabold tracking-tight text-sg-white">
          {title}
        </h1>
        {meta}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}
