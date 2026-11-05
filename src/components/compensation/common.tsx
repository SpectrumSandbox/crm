"use client";

/* Shared building blocks for the /compensation workspace (Policy v4.0 §8–§11). */
import { useMemo } from "react";
import Link from "next/link";
import { CircleAlert, Info, Lock, TriangleAlert, CircleCheck } from "lucide-react";
import { useCrm } from "@/lib/store";
import { useUserMap } from "@/lib/selectors";
import type { BonusRun, ClawbackTrigger, LineStatus } from "@/lib/initiatives/types";
import type { ProjectRate } from "@/lib/initiatives/engine";
import type { SpectrumColor } from "@/lib/types";
import { cn, formatIDR } from "@/lib/utils";
import { Avatar, Chip } from "@/components/ui/misc";
import { MoneyInput } from "@/components/ui/money-input";
import { Cite } from "@/components/initiatives/shared";

/** §9.1 inputs entered by Finance each month (rolling three closed months). */
export type RunInputValues = Pick<BonusRun, "companyRevenue" | "directCosts" | "overheads" | "cash" | "fixedCostsMonthly">;
export const EMPTY_INPUTS: RunInputValues = { companyRevenue: 0, directCosts: 0, overheads: 0, cash: 0, fixedCostsMonthly: 0 };

export const lineStatusMeta: Record<LineStatus, { label: string; color: SpectrumColor; hint: string }> = {
  payable: { label: "Payable", color: "green", hint: "Paid in full with the salary (§8.2)" },
  partially_deferred: { label: "Part deferred", color: "cyan", hint: "Part paid now, part deferred until 6–12 months after project close (§9.3)" },
  carried_forward: { label: "Carried forward", color: "yellow", hint: "A check failed — paid pro rata; the rest is paid first in the next passing month (§9.2)" },
  withheld_probation: { label: "Held · probation", color: "orange", hint: "Calculated normally, held until probation ends (§11.3)" },
  held: { label: "Held", color: "orange", hint: "Annex B not signed, suspension, unpaid leave over 30 days or retirement awaiting PRC confirmation (§10, §15.1)" },
  forfeited: { label: "Forfeited", color: "red", hint: "Not payable under §10 — returns to the company, never redistributed" },
  ineligible: { label: "Ineligible", color: "red", hint: "Employment status may not take part (§3.2)" },
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
  draft: { label: "Provisional", color: "blue" },
  failed: { label: "Checks failed", color: "red" },
  certified: { label: "Certified by CFO", color: "cyan" },
  released: { label: "Released by PRC", color: "green" },
};

export const triggerMeta: Record<ClawbackTrigger, { label: string; description: string }> = {
  revenue_reversal: { label: "Revenue reversed", description: "Client default, bad-debt write-off, contract cancellation or a scope reduction" },
  misconduct: { label: "Misconduct proven", description: "Fraud, gross negligence, an undisclosed conflict of interest or serious misconduct connected with the project, proven under the Company Regulations" },
  data_error: { label: "Data error", description: "Error in revenue, costs or the ledger that led to an overpayment — including one left after a §5.1 rate recalculation" },
};
/** §9.4 protections — never a clawback trigger. */
export const NOT_CLAWBACK = ["cost overruns", "rework", "warranty claims", "penalties", "legal settlements", "normal business or market risk"];

export const rateSourceLabel: Record<ProjectRate["source"], string> = {
  fixed: "fixed by the PRC at approval (§5.1)",
  v3_flat: "v3.0 flat share kept (§15.1)",
  curve: "from the curve on the expected case (§5.1)",
  provisional: "provisional — enter the expected case",
};

/** Revenue-share rate y with 3 decimals, e.g. 20.060 %. */
export function ratePct(v: number) {
  return `${(v * 100).toFixed(3)}%`;
}

export function RateCell({ rate }: { rate: Pick<ProjectRate, "rate" | "x" | "source"> }) {
  return (
    <span className="block">
      <span className="sg-num font-semibold text-sg-white">{ratePct(rate.rate)}</span>
      <span className={cn("block text-2xs", rate.source === "provisional" ? "text-soft-yellow" : "text-sg-dim")}>
        {rate.source === "curve" || rate.source === "fixed" ? `x ${formatIDR(rate.x)} · ` : ""}
        {rateSourceLabel[rate.source]}
      </span>
    </span>
  );
}

export function SampleChip({ demo }: { demo?: boolean }) {
  if (!demo) return null;
  return (
    <span title="Fictional sample record shipped with the demo data">
      <Chip color="blue">Sample</Chip>
    </span>
  );
}

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
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-semibold text-sg-white group-hover:underline">{ini.title}</span>
        <SampleChip demo={ini.demo} />
      </span>
      {!compact ? <span className="sg-num block text-2xs text-sg-dim">{ini.code ?? (ini.trackingNo || "—")}</span> : null}
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

export function shortMonthLabel(month: string) {
  const d = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return month;
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(d);
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

/** Plain numeric input (counts, percentages). For rupiah use parseIdr / AmountInput. */
export function parseAmount(v: string) {
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Rupiah input for the compensation and HR forms — the shared W2 MoneyInput (id-ID grouping, "7,2 M" miliar,
 * "720 jt"), adapted to number state: an empty or unreadable field leaves the last valid amount (0 when cleared).
 */
export function AmountInput({
  value,
  onChange,
  disabled,
  className,
  placeholder = "0",
  autoFocus,
  min = 0,
  "aria-label": ariaLabel,
  id,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  min?: number | null;
  "aria-label"?: string;
  id?: string;
}) {
  return (
    <MoneyInput
      id={id}
      value={value}
      onValueChange={(n) => onChange(n === null ? 0 : min != null ? Math.max(min, n) : n)}
      allowNegative={min == null}
      min={min ?? undefined}
      disabled={disabled}
      placeholder={placeholder}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      className={className}
    />
  );
}

/** Exact whole rupiah ("Rp 4.137.512"), never "Rp -0" (§8.4–8.5 statements show exact amounts). */
export function exactIdr(n: number) {
  const v = Math.abs(n) < 0.5 ? 0 : n;
  return formatIDR(v, "full");
}

export function ExactMoney({ value, className }: { value: number; className?: string }) {
  return <span className={cn("sg-num", className)}>{exactIdr(value)}</span>;
}

/** The profile holding the CFO role (§9.1) — the certifier the Finance team records on behalf of. */
export function useCfoId(): string | null {
  const profiles = useCrm((s) => s.employeeProfiles);
  return useMemo(() => profiles.find((p) => p.governanceRoles.includes("cfo"))?.userId ?? null, [profiles]);
}

/** §13.4 restricted screen for viewers without a Finance, HR or PRC role. */
export function NoAccess({ what, children }: { what: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div className="max-w-lg rounded-xl border border-sg-line bg-sg-card p-6 text-center">
        <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-sg-card-3 text-sg-muted">
          <Lock className="size-5" />
        </span>
        <h2 className="font-display text-lg font-extrabold text-sg-white">{what} is restricted</h2>
        <p className="mt-2 text-sm leading-relaxed text-sg-muted">
          Individual bonus amounts and employment status are personal data. Access is limited to Finance, HR, the PRC and the employee concerned <Cite s="13.4" />. Your own statements, deferred and held balances are on your page.
        </p>
        {children ? <div className="mt-3 text-xs text-sg-dim">{children}</div> : null}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href="/me" className="inline-flex h-8 items-center rounded-pill bg-sg-white px-4 text-sm font-semibold text-sg-bg hover:bg-sg-white/90">
            Go to my compensation
          </Link>
          <Link href="/policy#s-13-4" className="inline-flex h-8 items-center rounded-pill border border-sg-line px-4 text-sm font-semibold text-sg-text hover:border-sg-line-2">
            Read §13.4
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Inline explanation shown under a disabled governance action (§13.2). */
export function RoleNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1 text-2xs text-sg-dim">
      <Lock className="mt-px size-3 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
