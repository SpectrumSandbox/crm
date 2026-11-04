"use client";

/*
 * Policy handbook — the full text of Project Initiative and Compensation Policy v4.0 (docs/policy/v4.0.md),
 * navigable: sticky table of contents with scroll-spy, anchors (s-5-1, s-annex-d …), search, "In the app" links
 * to where each rule is enforced, live engine checks of the printed figures, and a print layout.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Link2, Printer, Search, X } from "lucide-react";
import { useUi } from "@/lib/store";
import { POLICY_DATED, POLICY_EFFECTIVE, POLICY_STATUS, POLICY_SUPERSEDES, POLICY_VERSION } from "@/lib/initiatives/policy";
import { cn, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Chip, EmptyState } from "@/components/ui/misc";
import { plainText, policyDoc, resolveAnchor, type PolicySection, type PolicySub } from "./model";
import { Inline, PolicyBlocks, PolicyRenderProvider } from "./render";
import { LiveCheck } from "./live-check";
import { LIVE_CHECKS } from "./examples";

/** Where each part of the policy is enforced in the app. */
export const IN_APP: Record<string, { href: string; label: string }[]> = {
  "s-4": [{ href: "/initiatives", label: "Proposals & PRC review" }],
  "s-5-1": [{ href: "/compensation?tab=policy", label: "Rate curve & calculator" }],
  "s-6-5": [{ href: "/projects", label: "Team Allocation Ledger" }],
  "s-6-8": [{ href: "/me", label: "Vote on amendments" }],
  "s-7-3": [{ href: "/people", label: "Leadership capacity" }],
  "s-8": [{ href: "/compensation", label: "Monthly bonus run" }],
  "s-9": [{ href: "/compensation", label: "Break-even test & release" }],
  "s-9-3": [{ href: "/compensation?tab=deferred", label: "Deferred bonuses" }],
  "s-9-4": [{ href: "/compensation?tab=clawbacks", label: "Clawbacks" }],
  "s-10": [{ href: "/people", label: "Status changes" }],
  "s-11": [{ href: "/compensation?tab=probation", label: "Probation balances" }],
  "s-annex-b": [{ href: "/me", label: "Sign in My compensation" }],
  "s-annex-e": [{ href: "/me", label: "My bonus statements" }],
};

function InApp({ id }: { id: string }) {
  const links = IN_APP[id];
  if (!links) return null;
  return (
    <span className="ml-auto flex shrink-0 flex-wrap items-center gap-1 print:hidden">
      {links.map((l) => (
        <Link key={l.href + l.label} href={l.href} className="inline-flex h-5 items-center gap-1 rounded-sm border border-soft-cyan/30 bg-soft-cyan/[0.06] px-1.5 text-2xs font-semibold text-soft-cyan hover:border-soft-cyan/60 hover:bg-soft-cyan/10">
          <span className="text-sg-dim">In the app:</span> {l.label}
          <ArrowUpRight className="size-3" />
        </Link>
      ))}
    </span>
  );
}

function CopyAnchor({ id, label }: { id: string; label: string }) {
  const notify = useUi((s) => s.notify);
  return (
    <button
      type="button"
      title={`Copy link to ${label}`}
      aria-label={`Copy link to ${label}`}
      onClick={() => {
        const url = `${window.location.origin}/policy#${id}`;
        if (!navigator.clipboard) {
          notify(url);
          return;
        }
        navigator.clipboard.writeText(url).then(
          () => notify(`Link to ${label} copied`),
          () => notify(url),
        );
      }}
      className="rounded p-0.5 text-sg-dim opacity-0 transition-opacity hover:text-sg-white focus-visible:opacity-100 group-hover:opacity-100 print:hidden"
    >
      <Link2 className="size-3.5" />
    </button>
  );
}

interface Visible {
  s: PolicySection;
  showIntro: boolean;
  subs: PolicySub[];
}

function filterDoc(sections: PolicySection[], query: string): Visible[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections.map((s) => ({ s, showIntro: true, subs: s.subs }));
  // "8.6", "§8.6", "annex b" jump by number
  const num = /^§?\s*(\d+(?:\.\d+)*)$/.exec(q)?.[1];
  const annex = /^annex\s+([a-h])$/.exec(q)?.[1];
  const out: Visible[] = [];
  for (const s of sections) {
    if (num) {
      const top = num.split(".")[0];
      if (s.kind !== "section" || s.num !== top) continue;
      const subs = num.includes(".") ? s.subs.filter((x) => x.num === num || x.num?.startsWith(`${num}.`)) : s.subs;
      out.push({ s, showIntro: !num.includes("."), subs });
      continue;
    }
    if (annex) {
      if (s.kind === "annex" && s.num?.toLowerCase() === annex) out.push({ s, showIntro: true, subs: s.subs });
      continue;
    }
    const titleHit = `${s.label} ${s.title}`.toLowerCase().includes(q);
    const introHit = s.search.includes(q);
    const subs = titleHit ? s.subs : s.subs.filter((x) => x.search.includes(q));
    if (titleHit || introHit || subs.length) out.push({ s, showIntro: titleHit || introHit, subs });
  }
  return out;
}

export function PolicyHandbook() {
  const doc = policyDoc();
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>(doc.sections[0]?.id ?? "");
  const scrollRef = useRef<HTMLDivElement>(null);
  const tocRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => filterDoc(doc.sections, query), [doc, query]);
  const sectionOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of doc.sections) {
      m.set(s.id, s.id);
      for (const x of s.subs) m.set(x.id, s.id);
    }
    return m;
  }, [doc]);
  const activeSection = sectionOf.get(activeId) ?? activeId;
  const owner = useMemo(() => {
    const dc = doc.sections.find((s) => s.kind === "control");
    const t = dc?.intro.find((b) => b.kind === "table");
    const row = t && t.kind === "table" ? t.rows.find((r) => /policy owner/i.test(r[0])) : null;
    return row ? plainText(row[1]) : "Chief Operating Officer";
  }, [doc]);

  /** smooth-scroll to an anchor, clearing a search that hides it */
  const navigate = useCallback(
    (rawId: string, opts: { push?: boolean; smooth?: boolean } = {}) => {
      const id = resolveAnchor(rawId) ?? rawId;
      const go = () => {
        const el = document.getElementById(id);
        if (!el) return;
        el.scrollIntoView({ behavior: opts.smooth === false ? "auto" : "smooth", block: "start" });
        setActiveId(id);
        try {
          if (window.location.hash !== `#${id}`) window.history[opts.push === false ? "replaceState" : "pushState"](window.history.state, "", `#${id}`);
        } catch {
          // history blocked — the scroll still happened
        }
      };
      if (!document.getElementById(id) && query) {
        setQuery("");
        requestAnimationFrame(() => requestAnimationFrame(go));
      } else go();
    },
    [query],
  );

  // deep links: /policy#s-9-1 (also from <Cite/> elsewhere in the app) and later hash changes
  useEffect(() => {
    const fromHash = () => {
      const h = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (h) requestAnimationFrame(() => navigate(h, { push: false, smooth: false }));
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // scroll-spy over every section / sub-section heading
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      const line = root.getBoundingClientRect().top + 96;
      const heads = root.querySelectorAll<HTMLElement>("[data-spy]");
      let current: HTMLElement | null = heads[0] ?? null;
      for (const h of heads) {
        if (h.getBoundingClientRect().top <= line) current = h;
        else break;
      }
      // at the very bottom, the last heading wins
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4 && heads.length) current = heads[heads.length - 1];
      if (current) setActiveId(current.id);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    compute();
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [visible]);

  // keep the active TOC entry in view
  useEffect(() => {
    tocRef.current?.querySelector(`[data-toc="${activeId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  // "/" focuses search, Esc clears it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const printAll = () => {
    if (query) {
      setQuery("");
      setTimeout(() => window.print(), 80);
    } else window.print();
  };

  const matchCount = visible.reduce((n, v) => n + v.subs.length + (v.showIntro && !v.s.subs.length ? 1 : 0), 0);
  const renderCtx = useMemo(() => ({ query, ids: doc.ids, onNavigate: (id: string) => navigate(id) }), [query, doc, navigate]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <style>{PRINT_CSS}</style>
      <PageHeader title="Policy handbook" meta={<Chip color="yellow">v{POLICY_VERSION} · {POLICY_STATUS}</Chip>} className="print:hidden">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-sg-dim" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
              if (e.key === "Enter" && visible[0]) navigate(visible[0].subs[0]?.id ?? visible[0].s.id);
            }}
            placeholder="Search the policy, or 8.6 / Annex B…"
            aria-label="Search the policy"
            className="pl-8 pr-7"
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-sg-dim hover:text-sg-white">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={printAll}>
          <Printer /> Print
        </Button>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        {/* sticky table of contents */}
        <nav ref={tocRef} aria-label="Policy contents" className="hidden w-72 shrink-0 overflow-y-auto border-r border-sg-line px-3 py-4 lg:block print:hidden">
          <div className="sg-eyebrow mb-2 px-2">{query ? `${matchCount} match${matchCount === 1 ? "" : "es"}` : "Contents"}</div>
          <ul className="space-y-px">
            {visible.map(({ s, subs }) => {
              const open = !!query || s.id === activeSection;
              return (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    data-toc={s.id}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(s.id);
                    }}
                    aria-current={s.id === activeId ? "location" : undefined}
                    className={cn("flex items-baseline gap-2 rounded px-2 py-1 text-xs transition-colors", s.id === activeSection ? "bg-sg-card-2 text-sg-white" : "text-sg-muted hover:bg-sg-card hover:text-sg-white")}
                  >
                    {s.label && <span className="sg-num w-12 shrink-0 text-2xs font-semibold text-sg-dim">{s.label}</span>}
                    <span className="min-w-0 truncate font-semibold">{s.title}</span>
                  </a>
                  {open && subs.length > 0 && (
                    <ul className="mb-1 ml-[3.25rem] mt-px space-y-px border-l border-sg-line pl-2">
                      {subs.map((x) => (
                        <li key={x.id}>
                          <a
                            href={`#${x.id}`}
                            data-toc={x.id}
                            onClick={(e) => {
                              e.preventDefault();
                              navigate(x.id);
                            }}
                            aria-current={x.id === activeId ? "location" : undefined}
                            className={cn("flex gap-1.5 rounded px-1.5 py-0.5 text-2xs transition-colors", x.id === activeId ? "font-semibold text-sg-white" : "text-sg-dim hover:text-sg-white")}
                          >
                            {x.num && <span className="sg-num shrink-0">{x.num}</span>}
                            <span className="truncate">{x.title}</span>
                            {LIVE_CHECKS[x.id] && <span className="ml-auto shrink-0 text-soft-cyan" title="Live engine check">●</span>}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {/* small screens: jump menu */}
          <div className="sticky top-0 z-10 border-b border-sg-line bg-sg-bg/95 px-4 py-2 backdrop-blur lg:hidden print:hidden">
            <Select aria-label="Jump to section" value={activeSection} onChange={(e) => navigate(e.target.value)}>
              {visible.map(({ s }) => (
                <option key={s.id} value={s.id}>
                  {s.label ? `${s.label} · ` : ""}
                  {s.title}
                </option>
              ))}
            </Select>
          </div>

          <PolicyRenderProvider value={renderCtx}>
            <article id="policy-print" className="mx-auto max-w-[860px] px-5 py-6 sm:px-8">
              {/* document header */}
              <header className="mb-6 rounded-xl border border-sg-line bg-sg-card p-5 print:border-0 print:p-0">
                <div className="flex items-start gap-3">
                  <BookOpen className="mt-1 size-5 shrink-0 text-soft-cyan print:hidden" />
                  <div className="min-w-0">
                    <h2 className="font-display text-2xl font-extrabold tracking-tight text-sg-white">{doc.title}</h2>
                    {doc.byline && <p className="mt-0.5 text-2xs text-sg-dim">{doc.byline}</p>}
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
                  <HeaderFact label="Version">{POLICY_VERSION}</HeaderFact>
                  <HeaderFact label="Status">
                    <Chip color="yellow" dot>
                      {POLICY_STATUS}
                    </Chip>
                  </HeaderFact>
                  <HeaderFact label="Dated">{formatDate(`${POLICY_DATED}T09:00:00+07:00`, "medium")}</HeaderFact>
                  <HeaderFact label="Pilot from">{formatDate(`${POLICY_EFFECTIVE}T09:00:00+07:00`, "medium")}</HeaderFact>
                  <HeaderFact label="Supersedes">Version {POLICY_SUPERSEDES}</HeaderFact>
                  <HeaderFact label="Owner">{owner === "Chief Operating Officer" ? "COO (Chief Operating Officer)" : owner}</HeaderFact>
                </dl>
                <p className="mt-4 rounded-lg border border-soft-orange/30 bg-soft-orange/[0.06] px-3 py-2 text-2xs text-sg-text">
                  <span className="font-semibold text-soft-orange">Bahasa Indonesia version prevails.</span> The policy is issued in Bahasa Indonesia and English; if the two differ, the Bahasa Indonesia version prevails. This page renders the English text.
                </p>
                {doc.preamble.length > 0 && (
                  <div className="mt-3">
                    <PolicyBlocks blocks={doc.preamble} />
                  </div>
                )}
              </header>

              {visible.length === 0 && (
                <EmptyState icon={Search} title="No section matches" action={<Button size="sm" variant="outline" onClick={() => setQuery("")}>Clear search</Button>}>
                  Nothing in the policy contains &ldquo;{query}&rdquo;. Try a shorter word, a section number such as 9.1, or &ldquo;Annex D&rdquo;.
                </EmptyState>
              )}

              {visible.map(({ s, showIntro, subs }) => (
                <section key={s.id} aria-labelledby={s.id} className="mb-8 print:mb-6">
                  <div className="group mb-2 flex flex-wrap items-center gap-2 border-b border-sg-line pb-2">
                    <h2 id={s.id} data-spy className="scroll-mt-16 font-display text-xl font-extrabold tracking-tight text-sg-white lg:scroll-mt-4">
                      {s.label && <span className="mr-2 text-sg-dim">{s.label}</span>}
                      {s.kind === "annex" ? "· " : ""}
                      {s.title}
                    </h2>
                    <CopyAnchor id={s.id} label={s.label || s.title} />
                    <InApp id={s.id} />
                  </div>
                  {showIntro && <PolicyBlocks blocks={s.intro} />}
                  {showIntro && LIVE_CHECKS[s.id] && <LiveCheck subId={s.id} />}
                  {query && !showIntro && s.intro.length > 0 && (
                    <button type="button" onClick={() => setQuery("")} className="mb-2 text-2xs text-sg-dim hover:text-sg-white print:hidden">
                      Section introduction hidden by the search — show all
                    </button>
                  )}
                  {subs.map((x) => (
                    <Fragment key={x.id}>
                      <div className="group mt-5 flex flex-wrap items-center gap-2">
                        <h3 id={x.id} data-spy className="scroll-mt-16 font-display text-[15px] font-bold text-sg-white lg:scroll-mt-4">
                          {x.num && <span className="sg-num mr-2 text-sg-dim">{x.num}</span>}
                          <Inline text={x.title} />
                        </h3>
                        <CopyAnchor id={x.id} label={x.num ? `§${x.num}` : x.title} />
                        <InApp id={x.id} />
                      </div>
                      <PolicyBlocks blocks={x.blocks} />
                      {LIVE_CHECKS[x.id] && <LiveCheck subId={x.id} />}
                    </Fragment>
                  ))}
                </section>
              ))}

              <footer className="mt-10 border-t border-sg-line pt-3 text-2xs text-sg-dim">
                Project Initiative and Compensation Policy · Version {POLICY_VERSION} ({POLICY_STATUS.toLowerCase()}) · {formatDate(`${POLICY_DATED}T09:00:00+07:00`, "medium")} · Source: docs/policy/v4.0.md
              </footer>
            </article>
          </PolicyRenderProvider>
        </div>
      </div>
    </div>
  );
}

function HeaderFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="sg-eyebrow">{label}</dt>
      <dd className="mt-0.5 font-semibold text-sg-white">{children}</dd>
    </div>
  );
}

/* Print: only the policy article, black on white, every section expanded. */
const PRINT_CSS = `
@media print {
  @page { margin: 14mm 12mm; }
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body * { visibility: hidden !important; }
  #policy-print, #policy-print * { visibility: visible !important; }
  #policy-print { position: absolute; left: 0; top: 0; width: 100%; max-width: none !important; padding: 0 !important; }
  #policy-print, #policy-print * { color: #111 !important; background: transparent !important; box-shadow: none !important; text-shadow: none !important; }
  #policy-print table, #policy-print th, #policy-print td, #policy-print div, #policy-print section, #policy-print header { border-color: #bbb !important; }
  #policy-print h2, #policy-print h3 { break-after: avoid; page-break-after: avoid; }
  #policy-print tr, #policy-print [role="math"] { break-inside: avoid; page-break-inside: avoid; }
  #policy-print a { text-decoration: none !important; }
}
`;
