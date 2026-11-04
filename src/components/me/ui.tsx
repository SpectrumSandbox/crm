"use client";

/* Small layout pieces for /me. */
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/ui/misc";
import { Money } from "@/components/initiatives/shared";

export function Card({ title, action, children, className, id }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-4 rounded-xl border border-sg-line bg-sg-card", className)}>
      <header className="flex flex-wrap items-center gap-2 border-b border-sg-line px-4 py-2.5">
        <h2 className="flex items-center font-display text-sm font-bold text-sg-white">{title}</h2>
        {action ? <div className="ml-auto flex flex-wrap items-center gap-2">{action}</div> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Right-aligned money cell; zero renders as a dim dash. */
export function NumCell({ v, tone, strong }: { v: number; tone?: string; strong?: boolean }) {
  return (
    <td className={cn("whitespace-nowrap px-2 py-1.5 text-right", v ? tone ?? "text-sg-text" : "text-sg-dim", strong && v ? "font-semibold text-sg-white" : "")}>
      {v ? <Money value={v} /> : "—"}
    </td>
  );
}

export function SampleChip() {
  return (
    <Chip color="blue" title="Fictional sample record shipped with the demo data">
      Sample
    </Chip>
  );
}

export const TH = "px-2 py-1.5 font-semibold";
export const THEAD_ROW = "border-b border-sg-line text-left text-2xs uppercase tracking-[0.1em] text-sg-dim";

/** Link to an annex of the policy, styled like <Cite/>. */
export function AnnexCite({ annex }: { annex: string }) {
  return (
    <Link href={`/policy#s-annex-${annex.toLowerCase()}`} className="ml-1 rounded-sm border border-sg-line px-1 text-[9px] font-semibold text-sg-dim hover:text-sg-white">
      Annex {annex.toUpperCase()}
    </Link>
  );
}
