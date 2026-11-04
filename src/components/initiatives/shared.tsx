"use client";

/* Shared UI for the Project Initiative & Compensation module. */
import { useMemo } from "react";
import { CircleCheck, CircleAlert, CircleX } from "lucide-react";
import { useCrm } from "@/lib/store";
import type { InitiativeStatus, ProjectRole, ProjectType } from "@/lib/initiatives/types";
import { leadershipLoad, participationEligibility } from "@/lib/initiatives/engine";
import { POLICY, PROJECT_TYPE_META, ROLE_META } from "@/lib/initiatives/policy";
import type { SpectrumColor } from "@/lib/types";
import { cn, formatIDR } from "@/lib/utils";
import { Chip } from "@/components/ui/misc";

export const initiativeStatusMeta: Record<InitiativeStatus, { label: string; color: SpectrumColor; stage: number }> = {
  draft: { label: "Draft", color: "blue", stage: 0 },
  submitted: { label: "Submitted", color: "magenta", stage: 1 },
  screening: { label: "Screening", color: "magenta", stage: 2 },
  evaluation: { label: "In evaluation", color: "yellow", stage: 3 },
  conditional: { label: "Conditional approval", color: "orange", stage: 4 },
  deferred: { label: "Deferred", color: "orange", stage: 4 },
  rejected: { label: "Rejected", color: "red", stage: 4 },
  approved: { label: "Approved", color: "cyan", stage: 5 },
  active: { label: "Active", color: "green", stage: 6 },
  completed: { label: "Completed", color: "blue", stage: 7 },
};

export function StatusChip({ status }: { status: InitiativeStatus }) {
  const m = initiativeStatusMeta[status];
  return (
    <Chip color={m.color} dot>
      {m.label}
    </Chip>
  );
}

export function TypeChip({ type, long }: { type: ProjectType; long?: boolean }) {
  const m = PROJECT_TYPE_META[type];
  return <Chip color={m.color}>{long ? m.label : `Type ${type} · ${m.short}`}</Chip>;
}

export function RoleChips({ roles }: { roles: ProjectRole[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <span key={r} className="rounded-sm bg-sg-card-3 px-1.5 py-0.5 text-2xs font-semibold text-sg-text">
          {ROLE_META[r].label}
        </span>
      ))}
    </span>
  );
}

export function Pct({ value }: { value: number }) {
  return <>{Math.round(value * 1000) / 10}%</>;
}

/** Rupiah with the full value on hover. */
export function Money({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("sg-num", className)} title={formatIDR(value, "full")}>
      {formatIDR(value)}
    </span>
  );
}

/** §2.1 eligibility badge for a user. */
export function EligibilityBadge({ userId, compact }: { userId: string; compact?: boolean }) {
  const profiles = useCrm((s) => s.employeeProfiles);
  const result = useMemo(() => participationEligibility(profiles.find((p) => p.userId === userId)), [profiles, userId]);
  const title = [...result.blockers, ...result.warnings].join("\n") || "Eligible (§2.1)";
  if (!result.ok)
    return (
      <span title={title} className="inline-flex items-center gap-1 text-2xs font-semibold text-soft-red">
        <CircleX className="size-3.5" /> {compact ? "" : "Not eligible"}
      </span>
    );
  if (result.warnings.length)
    return (
      <span title={title} className="inline-flex items-center gap-1 text-2xs font-semibold text-soft-yellow">
        <CircleAlert className="size-3.5" /> {compact ? "" : "Eligible · note"}
      </span>
    );
  return (
    <span title={title} className="inline-flex items-center gap-1 text-2xs font-semibold text-soft-green">
      <CircleCheck className="size-3.5" /> {compact ? "" : "Eligible"}
    </span>
  );
}

/** §5.1 leadership capacity bar (0 – 2.0). `adding` previews an extra load. */
export function CapacityMeter({ userId, adding = 0, className }: { userId: string; adding?: number; className?: string }) {
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const load = useMemo(() => leadershipLoad(userId, initiatives, members, { includePending: true }), [userId, initiatives, members]);
  const cap = POLICY.leadershipCapacity;
  const after = load.used + adding;
  const over = after > cap + 1e-9;
  return (
    <span className={cn("inline-flex items-center gap-2", className)} title={`Leadership capacity ${load.used.toFixed(2)} / ${cap.toFixed(1)}${adding ? ` → ${after.toFixed(2)} with this role` : ""} (§5.1)`}>
      <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-sg-card-3">
        <span className="absolute inset-y-0 left-0 bg-soft-cyan" style={{ width: `${Math.min(100, (load.used / cap) * 100)}%` }} />
        {adding > 0 && <span className={cn("absolute inset-y-0", over ? "bg-soft-red" : "bg-soft-yellow")} style={{ left: `${Math.min(100, (load.used / cap) * 100)}%`, width: `${Math.max(0, Math.min(100, (after / cap) * 100) - Math.min(100, (load.used / cap) * 100))}%` }} />}
      </span>
      <span className={cn("sg-num text-2xs font-semibold", over ? "text-soft-red" : "text-sg-muted")}>
        {after.toFixed(2)}/{cap.toFixed(1)}
      </span>
    </span>
  );
}

/** Small labelled metric used in headers and panels. */
export function Metric({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "green" | "orange" | "red" | "yellow" }) {
  return (
    <div>
      <div className="sg-eyebrow">{label}</div>
      <div className={cn("sg-num mt-0.5 font-display text-lg font-extrabold", tone === "green" ? "text-soft-green" : tone === "orange" ? "text-soft-orange" : tone === "red" ? "text-soft-red" : tone === "yellow" ? "text-soft-yellow" : "text-sg-white")}>{value}</div>
      {hint ? <div className="text-2xs text-sg-dim">{hint}</div> : null}
    </div>
  );
}

/** Policy citation tag, e.g. <Cite s="6.1" /> */
export function Cite({ s }: { s: string }) {
  return <span className="ml-1 rounded-sm border border-sg-line px-1 text-[9px] font-semibold text-sg-dim">§{s}</span>;
}
