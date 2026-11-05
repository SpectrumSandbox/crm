import { Skeleton, SpectrumRule } from "./misc";

const ROWS = [72, 58, 84, 64, 76, 52, 68, 80, 60, 70];

/** Page placeholder: header bar + a table of shimmering rows on the brand surfaces. Server-renderable. */
export function PageSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="flex min-h-0 flex-1 flex-col">
      <span className="sr-only">{label}</span>
      <div className="flex min-h-12 shrink-0 items-center gap-3 border-b border-sg-line px-4 py-2 sm:px-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="hidden h-4 w-24 sm:block" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-8 w-28 sm:w-48" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-4 sm:p-5">
        <div className="overflow-hidden rounded-xl border border-sg-line bg-sg-card">
          <div className="flex items-center gap-4 border-b border-sg-line px-4 py-3">
            <Skeleton className="size-4" rounded="rounded-sm" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="hidden h-3 w-20 md:block" />
            <Skeleton className="hidden h-3 w-24 md:block" />
            <Skeleton className="ml-auto h-3 w-16" />
          </div>
          {ROWS.map((w, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-sg-line px-4 py-3 last:border-b-0">
              <Skeleton className="size-4" rounded="rounded-sm" />
              <Skeleton className="size-6 shrink-0" rounded="rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3" style={{ width: `${w}%` }} />
                <Skeleton className="h-2.5 w-1/3" />
              </div>
              <Skeleton className="hidden h-3 w-24 md:block" />
              <Skeleton className="hidden h-5 w-16 md:block" rounded="rounded-sm" />
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const NAV = [
  { title: 56, items: [44, 40, 60, 66, 50] },
  { title: 64, items: [62, 84, 48, 92, 46] },
  { title: 88, items: [96] },
  { title: 82, items: [44, 104, 48] },
];

/**
 * The app shell as a skeleton — sidebar rail, mobile top bar and page placeholder — rendered on the server and shown
 * the moment the HTML arrives, while the workspace hydrates from local storage.
 */
export function ShellSkeleton() {
  return (
    <div data-shell-root className="flex h-dvh overflow-hidden" aria-busy="true">
      <aside aria-hidden className="hidden h-full w-[232px] shrink-0 flex-col border-r border-sg-line bg-sg-bg lg:flex">
        <div className="flex h-12 items-center gap-2 border-b border-sg-line px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/spectrum-logo.png" alt="" width={120} height={23} className="h-[23px] w-auto opacity-90" />
          <span className="rounded-sm border border-sg-line-2 px-1 text-[9px] font-bold uppercase tracking-[0.14em] text-sg-muted">CRM</span>
        </div>
        <div className="mx-2 mt-3 flex gap-1">
          <Skeleton className="h-8 flex-1" />
          <Skeleton className="size-8" />
        </div>
        <div className="mt-4 flex-1 space-y-5 px-2">
          {NAV.map((sec, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="ml-2 h-2.5" style={{ width: sec.title }} />
              {sec.items.map((w, j) => (
                <div key={j} className="flex h-6 items-center gap-2.5 px-2">
                  <Skeleton className="size-4" rounded="rounded-sm" />
                  <Skeleton className="h-3" style={{ width: w }} />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-sg-line p-3">
          <Skeleton className="size-6" rounded="rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-2 w-16" />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div aria-hidden className="flex h-12 shrink-0 items-center gap-2 border-b border-sg-line bg-sg-bg px-2 pt-[env(safe-area-inset-top)] lg:hidden">
          <Skeleton className="size-9" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/spectrum-logo.png" alt="" width={104} height={20} className="h-5 w-auto opacity-90" />
          <Skeleton className="ml-auto h-9 w-24" />
        </div>
        <SpectrumRule className="h-[2px] animate-pulse opacity-60" />
        <PageSkeleton label="Loading workspace…" />
      </div>
    </div>
  );
}
