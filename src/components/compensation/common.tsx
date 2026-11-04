"use client";

/* Shared building blocks for the /compensation workspace (§6). */
import { useMemo } from "react";
import Link from "next/link";
import { CircleAlert, Info, TriangleAlert, CircleCheck } from "lucide-react";
import { useCrm } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { ClawbackTrigger, LineStatus } from "@/lib/initiatives/types";
import type { SpectrumColor } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar, Chip } from "@/components/ui/misc";
import { Cite } from "@/components/initiatives/shared";

export const DEFAULT_OVERHEADS = 750_000_000;
export const DEFAULT_EBITDA = 4_000_000_000;

export const lineStatusMeta: Record<LineStatus, { label: string; color: SpectrumColor; hint: string }> = {
  payable: { label: "Payable", color: "green", hint: "Paid on the payment date" },
  partially_deferred: { label: "Partly deferred", color: "yellow", hint: "Part paid now, part deferred (§6.3) or carried over (§6.1)" },
  withheld_probation: { label: "Withheld · probation", color: "orange", hint: "Accrued until probation completes (§6.8)" },
  held: { label: "Held", color: "orange", hint: "Held pending standing / leave / PRC decision (§4.5)" },
  cap_review: { label: "Cap review", color: "magenta", hint: "Above 200% of annual base salary — CEO + PRC approval (§6.2)" },
  forfeited: { label: "Forfeited", color: "red", hint: "Not payable (§4.5)" },
  ineligible: { label: "Ineligible", color: "red", hint: "Not eligible to participate (§1.2)" },
};

export function LineStatusChip({ status }: { status: LineStatus }) {
  const m = lineStatusMeta[status];
  return (
    <span title={m.hint}>
      <Chip color={m.color} dot>
        {m.label}
      </Chip>
    </span>
  );
}

export const runStatusMeta: Record<"none" | "draft" | "failed" | "certified" | "released", { label: string; color: SpectrumColor }> = {
  none: { label: "Not started", color: "blue" },
  draft: { label: "Draft", color: "blue" },
  failed: { label: "Break-even failed", color: "red" },
  certified: { label: "Certified by CFO", color: "cyan" },
  released: { label: "Released by PRC", color: "green" },
};

export const triggerMeta: Record<ClawbackTrigger, { label: string; description: string }> = {
  revenue_reversal: { label: "Revenue reversal", description: "Client non-payment, refund or credit note after the bonus was paid" },
  cost_overrun: { label: "Cost overrun", description: "Material direct costs discovered after the bonus was calculated" },
  misconduct: { label: "Misconduct", description: "Fraud, misrepresentation or misconduct affecting the result" },
  data_error: { label: "Data / calculation error", description: "Error in revenue, cost or weight data" },
};

/** Bordered workspace card with an eyebrow-style header. */
export function Panel({
  title,
  cite,
  icon: Icon,
  actions,
  children,
  className,
  bodyClassName,
  subtitle,
}: {
  title: React.ReactNode;
  cite?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  subtitle?: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border border-sg-line bg-sg-card", className)}>
      <header className="flex flex-wrap items-center gap-2 border-b border-sg-line px-4 py-2.5">
        {Icon ? <Icon className="size-4 text-sg-muted" /> : null}
        <h2 className="font-display text-sm font-extrabold text-sg-white">
          {title}
          {cite ? <Cite s={cite} /> : null}
        </h2>
        {subtitle ? <span className="text-2xs text-sg-dim">{subtitle}</span> : null}
        {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

const calloutTone = {
  info: { box: "border-sg-line bg-sg-card-2/60 text-sg-muted", icon: Info, iconCls: "text-sg-muted" },
  warn: { box: "border-soft-yellow/30 bg-soft-yellow/10 text-soft-yellow", icon: TriangleAlert, iconCls: "text-soft-yellow" },
  danger: { box: "border-soft-red/30 bg-soft-red/10 text-soft-red", icon: CircleAlert, iconCls: "text-soft-red" },
  ok: { box: "border-soft-green/30 bg-soft-green/10 text-soft-green", icon: CircleCheck, iconCls: "text-soft-green" },
} as const;

export function Callout({ tone = "info", children, className }: { tone?: keyof typeof calloutTone; children: React.ReactNode; className?: string }) {
  const t = calloutTone[tone];
  const Icon = t.icon;
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed", t.box, className)}>
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", t.iconCls)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export const thCls = "px-3 py-2 text-left text-2xs font-semibold uppercase tracking-[0.1em] text-sg-dim";
export const thRight = "px-3 py-2 text-right text-2xs font-semibold uppercase tracking-[0.1em] text-sg-dim";
export const tdCls = "px-3 py-2 align-top";
export const tdNum = "sg-num px-3 py-2 text-right align-top";

export function useInitiativeMap() {
  const initiatives = useCrm((s) => s.initiatives);
  return useMemo(() => new Map(initiatives.map((i) => [i.id, i] as const)), [initiatives]);
}

export function InitiativeLink({ id, compact }: { id: string; compact?: boolean }) {
  const map = useInitiativeMap();
  const ini = map.get(id);
  if (!ini) return <span className="text-sg-dim">Unknown project</span>;
  return (
    <Link href={`/initiatives/${ini.id}`} className="group block min-w-0">
      <span className="block truncate font-semibold text-sg-white group-hover:underline">{ini.title}</span>
      {!compact ? <span className="sg-num block text-2xs text-sg-dim">{ini.code ?? ini.trackingNo ?? "—"}</span> : null}
    </Link>
  );
}

export function UserCell({ userId, sub }: { userId: string; sub?: React.ReactNode }) {
  const userMap = useUserMap();
  const u = userMap.get(userId);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar user={u} size="xs" />
      <span className="min-w-0">
        <span className="block truncate font-semibold text-sg-white">{u?.name ?? userId}</span>
        {sub ? <span className="block truncate text-2xs text-sg-dim">{sub}</span> : null}
      </span>
    </span>
  );
}

export function monthLabel(month: string) {
  const d = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return month;
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

export function pctLabel(v: number) {
  return `${Math.round(v * 1000) / 10}%`;
}

/** Days until (positive) or since (negative) an ISO timestamp, rendered as text. */
export function dueText(iso: string, now = Date.now()) {
  const days = Math.ceil((Date.parse(iso) - now) / 86_400_000);
  if (days > 1) return `${days} days remaining`;
  if (days === 1) return "1 day remaining";
  if (days === 0) return "due today";
  return `${-days} day${days === -1 ? "" : "s"} overdue`;
}

/** Numeric input that keeps IDR whole numbers. */
export function parseAmount(v: string) {
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
