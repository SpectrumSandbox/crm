import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  crumbs,
  children,
  meta,
  className,
}: {
  title: React.ReactNode;
  crumbs?: { href: string; label: string }[];
  children?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-sg-line px-5 py-2", className)}>
      <div className="flex min-w-0 items-center gap-2">
        {crumbs?.map((c) => (
          <span key={c.href} className="flex items-center gap-2 text-sm text-sg-dim">
            <Link href={c.href} className="hover:text-sg-white">
              {c.label}
            </Link>
            <ChevronRight className="size-3.5" />
          </span>
        ))}
        <h1 className="truncate font-display text-lg font-extrabold tracking-tight text-sg-white">{title}</h1>
        {meta}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}
