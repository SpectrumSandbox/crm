"use client";

/* Shared UI for the Project Initiative & Compensation module (Policy v4.0). */
import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { CircleCheck, CircleAlert, CircleX } from "lucide-react";
import { useCrm } from "@/lib/store";
import type { InitiativeStatus, Milestone, ProjectRole, ProjectType } from "@/lib/initiatives/types";
import { leadershipLoad, participationEligibility, revenueShareRate, type ProjectRate } from "@/lib/initiatives/engine";
import { CURVE, POLICY, PROJECT_TYPE_META, ROLE_META, TIER_META, type ApprovalTier, type Curve } from "@/lib/initiatives/policy";
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

const TIER_COLOR: Record<ApprovalTier, SpectrumColor> = { 1: "green", 2: "yellow", 3: "magenta" };
/** §4.2 approval tier chip. */
export function TierChip({ tier, long }: { tier: ApprovalTier; long?: boolean }) {
  return <Chip color={TIER_COLOR[tier]}>{long ? TIER_META[tier].label : `Tier ${tier}`}</Chip>;
}

/** Fictional demo record shipped with the seed. */
export function SampleChip({ className }: { className?: string }) {
  return (
    <span title="Sample record — fictional demo data" className={cn("inline-flex h-4 items-center rounded-sm border border-sg-line-2 px-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-sg-dim", className)}>
      Sample
    </span>
  );
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

/** Revenue-share rate y with 3 decimals, e.g. 20.060 % (§5.1 — the rate itself is never rounded). */
export const ratePct = (rate: number) => `${(rate * 100).toFixed(3)}%`;
export function Rate({ value, className }: { value: number; className?: string }) {
  return <span className={cn("sg-num", className)}>{ratePct(value)}</span>;
}

/** Where a project's rate comes from (§5.1, §15.1). */
export function rateSourceLabel(source: ProjectRate["source"]) {
  switch (source) {
    case "fixed":
      return "Fixed by the PRC at approval (§5.1)";
    case "v3_flat":
      return "v3.0 flat share kept (§15.1)";
    case "curve":
      return "From the curve on the expected case (§5.1)";
    case "provisional":
      return "Provisional — enter the expected case";
  }
}

/** Rupiah with the full value on hover. */
export function Money({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("sg-num", className)} title={formatIDR(value, "full")}>
      {formatIDR(value)}
    </span>
  );
}

/** §3 eligibility badge for a user. */
export function EligibilityBadge({ userId, compact }: { userId: string; compact?: boolean }) {
  const profiles = useCrm((s) => s.employeeProfiles);
  const result = useMemo(() => participationEligibility(profiles.find((p) => p.userId === userId)), [profiles, userId]);
  const title = [...result.blockers, ...result.warnings].join("\n") || "Eligible (§3.1)";
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

/** §7.3 leadership capacity bar (0 – 2.0). `adding` previews an extra load. */
export function CapacityMeter({ userId, adding = 0, className }: { userId: string; adding?: number; className?: string }) {
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const load = useMemo(() => leadershipLoad(userId, initiatives, members, { includePending: true }), [userId, initiatives, members]);
  const cap = POLICY.leadershipCapacity;
  const after = load.used + adding;
  const over = after > cap + 1e-9;
  return (
    <span className={cn("inline-flex items-center gap-2", className)} title={`Leadership capacity ${load.used.toFixed(2)} / ${cap.toFixed(1)}${adding ? ` → ${after.toFixed(2)} with this role` : ""} (§7.3)`}>
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

/** Anchor on the /policy page: "9.1" → s-9-1, "4.3.1" → s-4-3 (the page anchors two levels), "Annex D" → s-annex-d. */
export function policyAnchor(s: string) {
  const t = s.trim();
  const annex = /^annex\s+([a-z])/i.exec(t);
  if (annex) return `s-annex-${annex[1].toLowerCase()}`;
  const parts = t.split(".").filter(Boolean).slice(0, 2);
  return `s-${parts.join("-")}`;
}

/** Policy citation tag, e.g. <Cite s="9.1" /> — links to the section on /policy. */
export function Cite({ s }: { s: string }) {
  const annex = /^annex/i.test(s.trim());
  return (
    <Link
      href={`/policy#${policyAnchor(s)}`}
      onClick={(e) => e.stopPropagation()}
      title={`Policy v4.0 ${annex ? s : `§${s}`} — open in the policy`}
      className="ml-1 inline-flex items-center rounded-sm border border-sg-line px-1 align-middle text-[9px] font-semibold leading-[14px] text-sg-dim no-underline transition-colors hover:border-sg-line-2 hover:text-sg-white"
    >
      {annex ? s : `§${s}`}
    </Link>
  );
}

/* ───────────────────────── §5.1 revenue-share curve chart ───────────────────────── */

/**
 * Two small panels on one x axis (projected annual net revenue x): the rate y and the bonus pool x × y.
 * Two measures of different scale get two panels, never two y-axes. The project's point is marked.
 */
export function RateCurve({ x, curve = CURVE, months, light, className }: { x: number; curve?: Curve; months?: number; light?: boolean; className?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = 74;
  const padL = 34;
  const padR = 8;
  const xMax = Math.max(curve.decay * 1.4, x * 1.15, 1);
  const samples = 80;
  const pts = Array.from({ length: samples + 1 }, (_, i) => {
    const xv = (i / samples) * xMax;
    const y = revenueShareRate(xv, curve);
    return { x: xv, y, pool: xv * y };
  });
  const poolMax = Math.max(...pts.map((p) => p.pool), 1);
  const sx = (v: number) => padL + (v / xMax) * (W - padL - padR);
  const syRate = (v: number) => 6 + (1 - v / curve.start) * (H - 14);
  const syPool = (v: number) => 6 + (1 - v / poolMax) * (H - 14);
  const path = (sy: (v: number) => number, key: "y" | "pool") => pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p[key]).toFixed(1)}`).join(" ");
  const yHere = revenueShareRate(Math.max(0, x), curve);
  const poolHere = Math.max(0, x) * yHere;
  const hv = hover != null ? { x: hover, y: revenueShareRate(hover, curve), pool: hover * revenueShareRate(hover, curve) } : null;
  const ink = light ? "#111" : undefined;
  const grid = light ? "#bbb" : undefined;

  const onMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const e = event as unknown as { clientX: number; currentTarget: SVGSVGElement };
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const v = ((px - padL) / (W - padL - padR)) * xMax;
    setHover(v >= 0 && v <= xMax ? v : null);
  };

  const panel = (kind: "rate" | "pool") => {
    const sy = kind === "rate" ? syRate : syPool;
    const value = kind === "rate" ? yHere : poolHere;
    const top = kind === "rate" ? curve.start : poolMax;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={kind === "rate" ? `Revenue-share rate curve; this project ${ratePct(yHere)} at x ${formatIDR(x)}` : `Bonus pool per year; this project ${formatIDR(poolHere)}`}>
        <line x1={padL} x2={W - padR} y1={sy(0)} y2={sy(0)} className={light ? undefined : "stroke-sg-line"} stroke={grid} strokeWidth={1} />
        <line x1={sx(curve.decay)} x2={sx(curve.decay)} y1={6} y2={sy(0)} className={light ? undefined : "stroke-sg-line"} stroke={grid} strokeWidth={1} strokeDasharray="2 3" />
        <text x={padL - 4} y={sy(top) + 3} textAnchor="end" className={light ? undefined : "fill-sg-dim"} fill={ink} fontSize={8}>
          {kind === "rate" ? `${Math.round(curve.start * 100)}%` : formatIDR(top)}
        </text>
        <text x={padL - 4} y={sy(0) + 3} textAnchor="end" className={light ? undefined : "fill-sg-dim"} fill={ink} fontSize={8}>
          {kind === "rate" ? "0%" : "0"}
        </text>
        {kind === "rate" ? (
          <text x={sx(curve.decay)} y={sy(curve.floor) - 4} textAnchor="middle" className={light ? undefined : "fill-sg-dim"} fill={ink} fontSize={7.5}>
            floor {Math.round(curve.floor * 100)}% at {formatIDR(curve.decay)}
          </text>
        ) : null}
        <path d={path(sy, kind === "rate" ? "y" : "pool")} fill="none" className={light ? undefined : kind === "rate" ? "stroke-soft-cyan" : "stroke-soft-green"} stroke={light ? "#111" : undefined} strokeWidth={2} strokeLinejoin="round" />
        {hv ? (
          <>
            <line x1={sx(hv.x)} x2={sx(hv.x)} y1={6} y2={sy(0)} className={light ? undefined : "stroke-sg-line-2"} stroke={grid} strokeWidth={1} />
            <circle cx={sx(hv.x)} cy={sy(kind === "rate" ? hv.y : hv.pool)} r={3} className={light ? undefined : "fill-sg-white"} fill={ink} />
          </>
        ) : null}
        {x > 0 ? (
          <>
            <circle cx={sx(Math.min(x, xMax))} cy={sy(value)} r={4.5} className={light ? undefined : "fill-sg-white stroke-sg-card"} fill={light ? "#111" : undefined} stroke={light ? "#fff" : undefined} strokeWidth={2} />
          </>
        ) : null}
      </svg>
    );
  };

  return (
    <div className={cn("select-none", className)}>
      <div className="flex items-baseline justify-between gap-2 text-2xs">
        <span className={light ? undefined : "font-semibold text-sg-muted"}>Rate y</span>
        <span className={light ? undefined : "sg-num text-sg-white"}>{hv ? `${ratePct(hv.y)} at ${formatIDR(hv.x)}` : x > 0 ? `${ratePct(yHere)} — this project` : "enter the expected case"}</span>
      </div>
      {panel("rate")}
      <div className="mt-1 flex items-baseline justify-between gap-2 text-2xs">
        <span className={light ? undefined : "font-semibold text-sg-muted"}>Bonus pool per year x × y</span>
        <span className={light ? undefined : "sg-num text-sg-white"}>{hv ? formatIDR(hv.pool) : x > 0 ? `${formatIDR(poolHere)}${months && months > 12 ? " a year" : ""}` : "—"}</span>
      </div>
      {panel("pool")}
      <div className={light ? "text-[9px]" : "mt-0.5 flex justify-between pl-[34px] text-[9px] text-sg-dim"} style={light ? { display: "flex", justifyContent: "space-between", paddingLeft: 34 } : undefined}>
        <span>x = 0</span>
        <span>projected annual net revenue x →</span>
        <span>{formatIDR(xMax)}</span>
      </div>
    </div>
  );
}

/** Work period each payment milestone pays for: previous milestone's due date (or project start) → this due date (§6.5). */
export function milestoneWorkPeriods(milestones: Milestone[], startDate: string) {
  const sorted = [...milestones].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return new Map(sorted.map((m, i) => [m.id, { from: i ? sorted[i - 1].dueDate : startDate, to: m.dueDate }] as const));
}
