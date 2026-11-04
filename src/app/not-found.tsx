import Link from "next/link";
import { ArrowRight, Briefcase, Handshake, House, Kanban } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/shell/page-header";
import { Kbd, SpectrumRule } from "@/components/ui/misc";

const LINKS = [
  { href: "/home", label: "Home", hint: "Your day at a glance", icon: House },
  { href: "/deals", label: "Deals", hint: "Pipeline board & table", icon: Handshake },
  { href: "/board", label: "Agile board", hint: "Sprint delivery", icon: Kanban },
  { href: "/initiatives", label: "Initiatives", hint: "Proposals & PRC review", icon: Briefcase },
];

/** Branded 404 — rendered inside the workspace shell so the sidebar and ⌘K keep working. */
export default function NotFound() {
  return (
    <AppShell>
      <PageHeader title="Page not found" />
      <div className="flex flex-1 items-start justify-center overflow-y-auto px-4 py-10 sm:py-16">
        <section aria-labelledby="nf-title" className="w-full max-w-xl overflow-hidden rounded-xl border border-sg-line bg-sg-card">
          <SpectrumRule className="h-[2px]" />
          <div className="p-6">
            <div className="sg-eyebrow">404</div>
            <h2 id="nf-title" className="font-display text-2xl font-extrabold text-sg-white">
              We couldn&apos;t find that page
            </h2>
            <p className="mt-1 text-sm text-sg-muted">The link may be out of date, or the record was deleted. Jump somewhere useful instead:</p>
            <ul className="mt-5 grid gap-2 sm:grid-cols-2">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="group flex items-center gap-3 rounded-lg border border-sg-line bg-sg-bg/40 px-3 py-2.5 transition-colors hover:border-sg-line-2 hover:bg-sg-card-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-white/70"
                  >
                    <l.icon className="size-4 shrink-0 text-sg-muted group-hover:text-sg-white" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-sg-white">{l.label}</span>
                      <span className="block truncate text-2xs text-sg-dim">{l.hint}</span>
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-sg-dim group-hover:text-sg-white" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-5 flex flex-wrap items-center gap-1.5 text-xs text-sg-dim">
              Looking for a specific contact, deal or issue? Press
              <span className="inline-flex gap-1">
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
              </span>
              to search everything.
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
