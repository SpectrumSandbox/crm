"use client";

/* Small form primitives for the People (HR register) module. */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/** Accessible on/off switch. `danger` colours the "on" state red (for adverse HR flags). */
export function Toggle({ checked, onChange, label, hint, danger, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; hint?: React.ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1.5 hover:bg-sg-card-2", disabled && "cursor-not-allowed opacity-50")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-4 w-7 shrink-0 rounded-full border transition-colors",
          checked ? (danger ? "border-soft-red/60 bg-soft-red/40" : "border-soft-green/60 bg-soft-green/40") : "border-sg-line-2 bg-sg-card-3",
        )}
      >
        <span className={cn("absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-sg-white transition-[left]", checked ? "left-[14px]" : "left-[2px]")} />
      </button>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm", checked && danger ? "text-soft-red" : "text-sg-text")}>{label}</span>
        {hint ? <span className="block text-2xs text-sg-dim">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Text/number input that only commits on blur or Enter (so one audit entry per edit, not per keystroke). */
export function CommitInput({ value, onCommit, type = "text", className, ...rest }: { value: string | number; onCommit: (v: string) => void; type?: string; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    if (draft !== String(value)) onCommit(draft);
  };
  return (
    <Input
      {...rest}
      type={type}
      value={draft}
      className={className}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") setDraft(String(value));
      }}
    />
  );
}

/** Titled block inside the employee sheet. */
export function Block({ title, children, action, className }: { title: React.ReactNode; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-sg-line bg-sg-card", className)}>
      <header className="flex items-center gap-2 border-b border-sg-line px-4 py-2.5">
        <h3 className="flex flex-1 items-center text-xs font-bold uppercase tracking-[0.08em] text-sg-white">{title}</h3>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Thin progress bar; tone picks a literal colour class. */
export function Bar({ pct, tone, className }: { pct: number; tone: "cyan" | "yellow" | "red" | "green"; className?: string }) {
  const fill = tone === "red" ? "bg-soft-red" : tone === "yellow" ? "bg-soft-yellow" : tone === "green" ? "bg-soft-green" : "bg-soft-cyan";
  return (
    <span className={cn("relative block h-1.5 overflow-hidden rounded-full bg-sg-card-3", className)}>
      <span className={cn("absolute inset-y-0 left-0", fill)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}
