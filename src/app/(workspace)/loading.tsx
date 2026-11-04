import { Skeleton } from "@/components/ui/misc";

const ROWS = [72, 58, 84, 64, 76, 52, 68, 80, 60, 70];

/** Route-level skeleton: page header bar + a table of shimmering rows on the brand surfaces. */
export default function WorkspaceLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="flex min-h-0 flex-1 flex-col">
      <span className="sr-only">Loading…</span>
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
