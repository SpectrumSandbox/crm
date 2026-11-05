"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const APP_TITLE = "Spectrum CRM";

/* ───────────── Browser-tab title ─────────────
 * Every mounted PageHeader holds a claim; the newest claim wins and removing one falls back to the one below it.
 * This survives the races that used to reset the tab to "Spectrum CRM": an old page unmounting after the new one
 * mounted (Suspense / transitions), and Next re-rendering the metadata <title> after a client navigation. */

const claims: { id: string; text: string }[] = [];
let applied: string | null = null;
let observer: MutationObserver | null = null;
let burst = { at: 0, n: 0 };

function wanted() {
  const top = claims[claims.length - 1];
  const t = top?.text.replace(/\s+/g, " ").trim();
  return t ? `${t} · ${APP_TITLE}` : APP_TITLE;
}

function render() {
  if (typeof document === "undefined") return;
  applied = wanted();
  if (document.title !== applied) document.title = applied;
}

function watchHead() {
  if (observer || typeof MutationObserver === "undefined" || !document.head) return;
  observer = new MutationObserver(() => {
    if (!claims.length || document.title === applied) return;
    // something else (Next's metadata) rewrote the title — put ours back, but never fight a loop
    const now = Date.now();
    burst = now - burst.at > 1000 ? { at: now, n: 1 } : { at: burst.at, n: burst.n + 1 };
    if (burst.n <= 20) render();
  });
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
}

function claim(id: string, text: string) {
  const at = claims.findIndex((c) => c.id === id);
  if (at >= 0) claims[at] = { id, text };
  else claims.push({ id, text });
  watchHead();
  render();
}

function release(id: string) {
  const at = claims.findIndex((c) => c.id === id);
  if (at >= 0) claims.splice(at, 1);
  render();
}

/** Set the browser-tab title from a page that has no PageHeader ("<text> · Spectrum CRM"). */
export function useDocumentTitle(text: string | null | undefined) {
  const id = useId();
  useEffect(() => {
    if (!text) return;
    claim(id, text);
    return () => release(id);
  }, [id, text]);
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
  const id = useId();
  const plain = docTitle ?? (typeof title === "string" || typeof title === "number" ? String(title) : null);

  useEffect(() => {
    if (plain !== null) {
      claim(id, plain);
      return;
    }
    // ReactNode title (e.g. <RecordTitle/>): mirror the rendered heading text, which may change after data loads
    const el = h1.current;
    if (!el) return;
    claim(id, el.textContent ?? "");
    const mo = new MutationObserver(() => claim(id, el.textContent ?? ""));
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [plain, id]);

  // release on unmount; the next header down the stack (or the app name) takes over
  useEffect(() => () => release(id), [id]);

  /*
   * Layout: title + meta on the left, actions on the right. When they don't fit (tablet), the actions wrap onto their
   * own row instead of squeezing the title, and meta chips wrap under the title — the H1 only truncates when it is
   * longer than the whole row.
   */
  return (
    <header className={cn("flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-sg-line px-4 py-2 sm:px-5", className)}>
      <div className="flex min-w-0 max-w-full flex-[1_1_auto] flex-wrap items-center gap-x-2 gap-y-1">
        {crumbs?.length ? (
          <nav aria-label="Breadcrumb" className="flex min-w-0 max-w-full items-center gap-2">
            {crumbs.map((c) => (
              <span key={c.href} className="flex min-w-0 items-center gap-2 text-sm text-sg-dim">
                <Link href={c.href} className="truncate rounded-sm hover:text-sg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sg-white/60">
                  {c.label}
                </Link>
                <ChevronRight className="size-3.5 shrink-0" aria-hidden />
              </span>
            ))}
          </nav>
        ) : null}
        <h1 ref={h1} className="min-w-0 max-w-full truncate font-display text-lg font-extrabold tracking-tight text-sg-white">
          {title}
        </h1>
        {meta ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {children ? <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2 print:hidden">{children}</div> : null}
    </header>
  );
}
