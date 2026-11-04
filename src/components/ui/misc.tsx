"use client";

import * as React from "react";
import type { SpectrumColor, User } from "@/lib/types";
import { cn, softChip, spectrumDot } from "@/lib/utils";

export function Chip({ color = "blue", children, className, dot }: { color?: SpectrumColor; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 text-2xs font-semibold ring-1 ring-inset", softChip[color], className)}>
      {dot ? <span className={cn("size-1.5 rounded-full", spectrumDot[color])} /> : null}
      {children}
    </span>
  );
}

export function Dot({ color, className }: { color: SpectrumColor; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", spectrumDot[color], className)} />;
}

const avatarBg: Record<SpectrumColor, string> = {
  magenta: "bg-soft-magenta/25 text-soft-magenta",
  blue: "bg-soft-blue/25 text-soft-blue",
  cyan: "bg-soft-cyan/25 text-soft-cyan",
  green: "bg-soft-green/25 text-soft-green",
  yellow: "bg-soft-yellow/25 text-soft-yellow",
  orange: "bg-soft-orange/25 text-soft-orange",
  red: "bg-soft-red/25 text-soft-red",
};

export function Avatar({ user, size = "sm", className, title }: { user?: Pick<User, "initials" | "color" | "name"> | null; size?: "xs" | "sm" | "md" | "lg"; className?: string; title?: string }) {
  const dims = { xs: "size-5 text-[9px]", sm: "size-6 text-2xs", md: "size-8 text-xs", lg: "size-11 text-sm" }[size];
  if (!user) {
    return <span title={title ?? "Unassigned"} className={cn("inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-sg-line-2 text-sg-dim", dims, className)}>?</span>;
  }
  return (
    <span title={title ?? user.name} className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-bold", avatarBg[user.color], dims, className)}>
      {user.initials}
    </span>
  );
}

/** Initials avatar for CRM records (contacts / companies) */
export function RecordAvatar({ label, color = "blue", size = "md", square }: { label: string; color?: SpectrumColor; size?: "sm" | "md" | "lg" | "xl"; square?: boolean }) {
  const dims = { sm: "size-6 text-2xs", md: "size-8 text-xs", lg: "size-11 text-sm", xl: "size-14 text-lg" }[size];
  const text = label
    .split(/\s+/)
    .filter((w) => /[A-Za-z]/.test(w[0] ?? ""))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return <span className={cn("inline-flex shrink-0 items-center justify-center font-bold", square ? "rounded-md" : "rounded-full", avatarBg[color], dims)}>{text}</span>;
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-sg-line-2 bg-sg-bg px-1 font-sans text-[10px] font-semibold text-sg-muted", className)}>{children}</kbd>;
}

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("sg-eyebrow", className)}>{children}</div>;
}

export function EmptyState({ icon: Icon, title, children, action }: { icon?: React.ComponentType<{ className?: string }>; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {Icon ? <Icon className="size-6 text-sg-dim" /> : null}
      <p className="font-display text-sm font-bold text-sg-white">{title}</p>
      {children ? <p className="max-w-sm text-xs text-sg-muted">{children}</p> : null}
      {action}
    </div>
  );
}

/** Circular lead-score gauge (0–100) using the spectrum colour for its band. */
export function ScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const color = score >= 80 ? "rgb(var(--sg-s-green))" : score >= 60 ? "rgb(var(--sg-s-yellow))" : score >= 40 ? "rgb(var(--sg-s-orange))" : "rgb(var(--sg-s-red))";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label={`Lead score ${score}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sg-line)" strokeWidth={4} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={`${(Math.max(0, Math.min(100, score)) / 100) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-sg-white font-display text-[12px] font-extrabold">
        {score}
      </text>
    </svg>
  );
}

export function SpectrumRule({ className }: { className?: string }) {
  return <div className={cn("sg-spectrum-rule h-[3px] w-full", className)} aria-hidden />;
}

/** The seven ascending bars from the Spectrum Group mark. */
export function SpectrumMark({ className }: { className?: string }) {
  const bars: SpectrumColor[] = ["magenta", "blue", "cyan", "green", "yellow", "orange", "red"];
  return (
    <span className={cn("inline-flex h-3 items-end gap-[2px]", className)} aria-hidden>
      {bars.map((c, i) => (
        <span key={c} className={cn("h-full rounded-[1px]", spectrumDot[c])} style={{ width: 2 + i * 1.2 }} />
      ))}
    </span>
  );
}
