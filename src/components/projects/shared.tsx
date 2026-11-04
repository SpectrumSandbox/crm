"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CircleAlert, CircleCheck, CircleX } from "lucide-react";
import { useCrm } from "@/lib/store";
import { cn } from "@/lib/utils";
import { buildRegister, type ComplianceItem, type ComplianceStatus, type RegisterInputs } from "./model";

/** Raw store slices for the register (Zustand v5: select raw slices, derive with useMemo). */
export function useRegisterInputs(): RegisterInputs {
  const initiatives = useCrm((s) => s.initiatives);
  const members = useCrm((s) => s.initiativeMembers);
  const profiles = useCrm((s) => s.employeeProfiles);
  const users = useCrm((s) => s.users);
  const entries = useCrm((s) => s.revenueEntries);
  const adjustments = useCrm((s) => s.curveAdjustments);
  const amendments = useCrm((s) => s.teamAmendments);
  return useMemo(() => ({ initiatives, members, profiles, users, entries, adjustments, amendments }), [initiatives, members, profiles, users, entries, adjustments, amendments]);
}

export function useProjectRegister(id: string) {
  const inp = useRegisterInputs();
  return useMemo(() => {
    const ini = inp.initiatives.find((i) => i.id === id);
    return ini ? buildRegister(ini, inp) : null;
  }, [inp, id]);
}

export function PolicyRef({ s }: { s: string }) {
  return (
    <Link href={`/policy#s-${s.replace(/\./g, "-").toLowerCase()}`} className="sg-num whitespace-nowrap text-2xs font-semibold text-sg-dim underline-offset-2 hover:text-sg-white hover:underline" title={`Policy v4.0 §${s}`}>
      §{s}
    </Link>
  );
}

const STATUS_ICON: Record<ComplianceStatus, { icon: typeof CircleCheck; cls: string; label: string }> = {
  ok: { icon: CircleCheck, cls: "text-soft-green", label: "Meets the policy" },
  warn: { icon: CircleAlert, cls: "text-soft-orange", label: "Needs attention" },
  fail: { icon: CircleX, cls: "text-soft-red", label: "Does not meet the policy yet" },
};

export function ComplianceIcon({ status, className }: { status: ComplianceStatus; className?: string }) {
  const m = STATUS_ICON[status];
  const Icon = m.icon;
  return <Icon className={cn("size-4 shrink-0", m.cls, className)} aria-label={m.label} />;
}

export function ComplianceList({ items, compact }: { items: ComplianceItem[]; compact?: boolean }) {
  return (
    <ul className="divide-y divide-sg-line">
      {items.map((c) => (
        <li key={c.id} className={cn("flex items-start gap-2.5", compact ? "py-1.5" : "py-2.5")}>
          <ComplianceIcon status={c.status} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-sg-white">{c.label}</span>
              <PolicyRef s={c.cite} />
            </div>
            {!compact || c.status !== "ok" ? <p className="mt-0.5 text-xs text-sg-muted">{c.detail}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ComplianceSummary({ failing, warnings }: { failing: number; warnings: number }) {
  if (!failing && !warnings)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-soft-green">
        <CircleCheck className="size-3.5" /> Meets the policy
      </span>
    );
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold">
      {failing ? (
        <span className="inline-flex items-center gap-1 text-soft-red">
          <CircleX className="size-3.5" /> {failing} to fix
        </span>
      ) : null}
      {warnings ? (
        <span className="inline-flex items-center gap-1 text-soft-orange">
          <CircleAlert className="size-3.5" /> {warnings} to review
        </span>
      ) : null}
    </span>
  );
}
